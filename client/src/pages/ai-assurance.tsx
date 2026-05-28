import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  BrainCircuit, Zap, CheckCircle2, XCircle, Eye, Clock,
  TrendingDown, AlertTriangle, Activity, BarChart2, Search,
  RefreshCw, ChevronDown, ChevronRight,
} from "lucide-react";

interface AiAlert {
  id: number; alertType: string; severity: string; anomalyScore: number;
  clientName?: string; vendorName?: string; billingPeriod?: string;
  baselineValue?: number; currentValue?: number; deviationPct?: number;
  evidence?: any; recommendedAction?: string; status: string;
  reviewedBy?: string; reviewedAt?: string; resolvedAt?: string;
  dismissedReason?: string; detectedOn: string; createdAt: string;
}

interface ScanRun {
  id: number; triggeredBy?: string; alertsCreated: number; detectorsRan: number;
  durationMs?: number; status: string; error?: string; startedAt: string; completedAt?: string;
}

const SEVERITY_CFG: Record<string, { color: string; label: string }> = {
  critical: { color: 'text-red-400 bg-red-400/10 border-red-400/30',       label: 'Critical' },
  high:     { color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', label: 'High'   },
  medium:   { color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',  label: 'Medium'   },
  low:      { color: 'text-sky-400 bg-sky-400/10 border-sky-400/30',        label: 'Low'      },
};

const STATUS_CFG: Record<string, { color: string; label: string; icon: any }> = {
  OPEN:       { color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',   label: 'Open',       icon: AlertTriangle  },
  REVIEWING:  { color: 'text-purple-400 bg-purple-400/10 border-purple-400/30', label: 'Reviewing', icon: Eye            },
  DISMISSED:  { color: 'text-slate-400 bg-slate-400/10 border-slate-400/30',   label: 'Dismissed',  icon: XCircle        },
  RESOLVED:   { color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', label: 'Resolved', icon: CheckCircle2 },
};

const ALERT_TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  margin_collapse:        { label: 'Margin Collapse',        icon: TrendingDown, color: 'text-red-400'    },
  asr_drop:               { label: 'ASR Drop',               icon: Activity,     color: 'text-orange-400' },
  revenue_drop:           { label: 'Revenue Drop',           icon: BarChart2,    color: 'text-amber-400'  },
  reconciliation_drift:   { label: 'Reconciliation Drift',   icon: RefreshCw,    color: 'text-purple-400' },
  credit_note_clustering: { label: 'Credit Clustering',      icon: AlertTriangle, color: 'text-rose-400'  },
};

const dismissSchema = z.object({ reason: z.string().min(1, 'Reason required') });

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEVERITY_CFG[severity] ?? SEVERITY_CFG.low;
  return <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.OPEN;
  const Icon = cfg.icon;
  return <Badge variant="outline" className={`text-xs gap-1 ${cfg.color}`}><Icon className="h-3 w-3" />{cfg.label}</Badge>;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-red-500' : score >= 60 ? 'bg-orange-500' : score >= 35 ? 'bg-amber-500' : 'bg-sky-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums w-7 text-right font-medium">{score}</span>
    </div>
  );
}

function EvidenceViewer({ evidence }: { evidence: any }) {
  const [open, setOpen] = useState(false);
  if (!evidence) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div>
      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}Evidence
      </Button>
      {open && (
        <pre className="mt-1 text-xs bg-muted/40 rounded p-2 overflow-auto max-h-48 max-w-md">
          {JSON.stringify(evidence, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function AiAssurancePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState('alerts');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterStatus, setFilterStatus] = useState('OPEN');
  const [search, setSearch] = useState('');
  const [dismissAlertId, setDismissAlertId] = useState<number | null>(null);

  const { data: alerts = [], isLoading: aLoading } = useQuery<AiAlert[]>({
    queryKey: ['/api/ai-assurance/alerts'],
    queryFn:  () => apiRequest('GET', '/api/ai-assurance/alerts').then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: scanRuns = [], isLoading: sLoading } = useQuery<ScanRun[]>({
    queryKey: ['/api/ai-assurance/scans'],
    queryFn:  () => apiRequest('GET', '/api/ai-assurance/scans').then(r => r.json()),
    refetchInterval: 30000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/api/ai-assurance/alerts'] });
    qc.invalidateQueries({ queryKey: ['/api/ai-assurance/scans'] });
  };

  const scanMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/ai-assurance/scan', {}).then(r => r.json()),
    onSuccess: (d) => {
      invalidate();
      toast({ title: `Scan complete — ${d.totalAlerts} alert(s) created in ${(d.durationMs / 1000).toFixed(1)}s` });
    },
    onError: (e: any) => toast({ title: 'Scan failed', description: e.message, variant: 'destructive' }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: string; body?: any }) =>
      apiRequest('PATCH', `/api/ai-assurance/alerts/${id}/${action}`, body ?? {}).then(r => r.json()),
    onSuccess: (_, v) => {
      invalidate();
      toast({ title: { review: 'Marked as reviewing', resolve: 'Resolved', dismiss: 'Dismissed' }[v.action] ?? 'Done' });
      setDismissAlertId(null); dismissForm.reset();
    },
    onError: (e: any) => toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  });

  const dismissForm = useForm({ resolver: zodResolver(dismissSchema), defaultValues: { reason: '' } });

  const filtered = alerts.filter(a => {
    const matchSev    = filterSeverity === 'all' || a.severity === filterSeverity;
    const matchStatus = filterStatus   === 'all' || a.status   === filterStatus;
    const matchSearch = !search || (a.clientName ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (ALERT_TYPE_META[a.alertType]?.label ?? a.alertType).toLowerCase().includes(search.toLowerCase());
    return matchSev && matchStatus && matchSearch;
  });

  const counts = {
    open:      alerts.filter(a => a.status === 'OPEN').length,
    critical:  alerts.filter(a => a.severity === 'critical' && a.status === 'OPEN').length,
    high:      alerts.filter(a => a.severity === 'high'     && a.status === 'OPEN').length,
    resolved:  alerts.filter(a => a.status === 'RESOLVED').length,
  };

  const lastScan = scanRuns[0];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-primary" />AI Revenue Assurance
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Advisory-only anomaly detection — AI suggests, humans approve, platform acts
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastScan && (
            <p className="text-xs text-muted-foreground hidden sm:block">
              Last scan: {new Date(lastScan.startedAt).toLocaleString()} · {lastScan.alertsCreated} alerts
            </p>
          )}
          <Button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending} data-testid="button-run-scan">
            <Zap className="h-4 w-4 mr-1.5" />
            {scanMutation.isPending ? 'Scanning…' : 'Run Scan'}
          </Button>
        </div>
      </div>

      {/* Advisory Banner */}
      <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-300/90">
          <strong>Advisory Mode:</strong> All alerts are recommendations only. No automatic finance actions are taken. Review each alert, investigate the evidence, and take manual action through the appropriate governance module.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Open Alerts',    count: counts.open,     color: 'text-amber-400',   filter: 'OPEN'     },
          { label: 'Critical',       count: counts.critical,  color: 'text-red-400',     filter: 'critical' },
          { label: 'High Severity',  count: counts.high,      color: 'text-orange-400',  filter: 'high'     },
          { label: 'Resolved',       count: counts.resolved,  color: 'text-emerald-400', filter: 'RESOLVED' },
        ].map(s => (
          <Card key={s.label} className="cursor-pointer hover:bg-muted/20 transition-colors" data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, '-')}`}
            onClick={() => {
              if (['critical', 'high'].includes(s.filter)) { setFilterSeverity(filterSeverity === s.filter ? 'all' : s.filter); setFilterStatus('OPEN'); }
              else { setFilterStatus(filterStatus === s.filter ? 'all' : s.filter); setFilterSeverity('all'); }
            }}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="alerts"><AlertTriangle className="h-4 w-4 mr-1.5" />Alerts ({alerts.length})</TabsTrigger>
          <TabsTrigger value="scans"><Clock className="h-4 w-4 mr-1.5" />Scan History ({scanRuns.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-4 space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search alerts…" className="pl-8" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
            </div>
            <div className="flex gap-1 flex-wrap">
              {['all', 'OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'].map(s => (
                <Button key={s} size="sm" variant={filterStatus === s ? 'default' : 'outline'} className="h-8 text-xs"
                  onClick={() => setFilterStatus(s)}>{s === 'all' ? 'All' : STATUS_CFG[s]?.label ?? s}</Button>
              ))}
            </div>
            <div className="flex gap-1">
              {['all', 'critical', 'high', 'medium', 'low'].map(s => (
                <Button key={s} size="sm" variant={filterSeverity === s ? 'secondary' : 'ghost'} className="h-8 text-xs capitalize"
                  onClick={() => setFilterSeverity(s)}>{s}</Button>
              ))}
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Alert Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Client / Vendor</TableHead>
                    <TableHead>Deviation</TableHead>
                    <TableHead>Recommended Action</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aLoading && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                  {!aLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12">
                        <BrainCircuit className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                        <p className="text-muted-foreground">No alerts match your filters.</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Run a scan to detect revenue anomalies.</p>
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map(a => {
                    const meta = ALERT_TYPE_META[a.alertType] ?? { label: a.alertType, icon: AlertTriangle, color: 'text-muted-foreground' };
                    const Icon = meta.icon;
                    return (
                      <TableRow key={a.id} data-testid={`row-alert-${a.id}`} className={a.severity === 'critical' ? 'bg-red-500/5' : a.severity === 'high' ? 'bg-orange-500/5' : ''}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                            <span className="text-sm font-medium">{meta.label}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{new Date(a.detectedOn).toLocaleDateString()}</div>
                        </TableCell>
                        <TableCell><SeverityBadge severity={a.severity} /></TableCell>
                        <TableCell className="min-w-[100px]"><ScoreBar score={a.anomalyScore} /></TableCell>
                        <TableCell className="text-sm">{a.clientName ?? a.vendorName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          {a.deviationPct != null && (
                            <span className={`text-sm font-medium tabular-nums ${a.deviationPct > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {a.deviationPct > 0 ? '+' : ''}{a.deviationPct.toFixed(1)}%
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[220px]">
                          <p className="line-clamp-2">{a.recommendedAction ?? '—'}</p>
                        </TableCell>
                        <TableCell><EvidenceViewer evidence={a.evidence} /></TableCell>
                        <TableCell><StatusBadge status={a.status} /></TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {a.status === 'OPEN' && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs text-purple-400" data-testid={`button-review-${a.id}`}
                                onClick={() => actionMutation.mutate({ id: a.id, action: 'review' })}>
                                <Eye className="h-3 w-3 mr-1" />Review
                              </Button>
                            )}
                            {['OPEN', 'REVIEWING'].includes(a.status) && (
                              <>
                                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" data-testid={`button-resolve-${a.id}`}
                                  onClick={() => actionMutation.mutate({ id: a.id, action: 'resolve' })}>
                                  <CheckCircle2 className="h-3 w-3 mr-1" />Resolve
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400" data-testid={`button-dismiss-${a.id}`}
                                  onClick={() => { setDismissAlertId(a.id); dismissForm.reset(); }}>
                                  <XCircle className="h-3 w-3 mr-1" />Dismiss
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scans" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scan #</TableHead>
                    <TableHead>Triggered By</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Alerts Created</TableHead>
                    <TableHead>Detectors</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sLoading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                  {!sLoading && scanRuns.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No scans yet. Click "Run Scan" to start.</TableCell></TableRow>
                  )}
                  {scanRuns.map(s => (
                    <TableRow key={s.id} data-testid={`row-scan-${s.id}`}>
                      <TableCell className="font-mono text-sm">#{s.id}</TableCell>
                      <TableCell className="text-sm">{s.triggeredBy ?? 'system'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${s.status === 'completed' ? 'text-emerald-400 border-emerald-400/30' : s.status === 'failed' ? 'text-red-400 border-red-400/30' : 'text-amber-400 border-amber-400/30'}`}>
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={`font-bold text-sm ${s.alertsCreated > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{s.alertsCreated}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.detectorsRan}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.durationMs != null ? `${(s.durationMs / 1000).toFixed(1)}s` : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(s.startedAt).toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.completedAt ? new Date(s.completedAt).toLocaleString() : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dismiss Dialog */}
      <Dialog open={dismissAlertId != null} onOpenChange={() => setDismissAlertId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dismiss Alert</DialogTitle></DialogHeader>
          <Form {...dismissForm}>
            <form onSubmit={dismissForm.handleSubmit(d =>
              dismissAlertId && actionMutation.mutate({ id: dismissAlertId, action: 'dismiss', body: { reason: d.reason } })
            )} className="space-y-4">
              <FormField control={dismissForm.control} name="reason" render={({ field }) => (
                <FormItem><FormLabel>Dismiss Reason</FormLabel>
                  <FormControl><Input data-testid="input-dismiss-reason" placeholder="Explain why this alert is not actionable…" {...field} /></FormControl>
                  <FormMessage /></FormItem>
              )} />
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setDismissAlertId(null)}>Cancel</Button>
                <Button type="submit" variant="destructive">Dismiss Alert</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
