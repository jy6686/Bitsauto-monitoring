import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SendHorizonal, Clock, CheckCircle2, XCircle, RefreshCw, Plus,
  Search, FileText, ChevronRight, AlertTriangle, Ban,
  ThumbsUp, ThumbsDown, RotateCcw, Calendar, Users, DollarSign,
  Layers, ArrowRight, ShieldCheck, ShieldAlert, Loader2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface InvoiceJob {
  id:            number;
  clientName:    string;
  clientId?:     string;
  billingPeriod: string;
  invoiceId?:    number;
  status:        string;
  batchId?:      number;
  scheduledAt?:  string;
  generatedAt?:  string;
  approvedAt?:   string;
  approvedBy?:   string;
  sentAt?:       string;
  failedAt?:     string;
  retryCount:    number;
  lastError?:    string;
  notes?:        string;
  createdBy?:    string;
  createdAt:     string;
}

interface InvoiceBatch {
  id:               number;
  batchRef:         string;
  billingCycle:     string;
  periodStart:      string;
  periodEnd:        string;
  periodLabel:      string;
  scope:            string;
  status:           string;
  clientsFound:     number;
  clientsApproved:  number;
  estimatedRevenue: string;
  createdAt:        string;
  total_jobs?:      number;
  sent_jobs?:       number;
  failed_jobs?:     number;
  pending_jobs?:    number;
}

interface BatchPreview {
  periodStart:      string;
  periodEnd:        string;
  periodLabel:      string;
  snapshotRunId:    number | null;
  reconRunId:       number | null;
  reconCertified:   boolean;
  clientsFound:     number;
  estimatedRevenue: number;
  clients:          Array<{ accountId: string; accountName: string; revenue: number; eligible: boolean }>;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { color: string; icon: any; label: string }> = {
  PENDING:   { color: 'text-slate-400 bg-slate-400/10 border-slate-400/30',    icon: Clock,        label: 'Pending'   },
  GENERATED: { color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',       icon: FileText,     label: 'Generated' },
  REVIEW:    { color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',    icon: AlertTriangle, label: 'Review'   },
  APPROVED:  { color: 'text-purple-400 bg-purple-400/10 border-purple-400/30', icon: CheckCircle2, label: 'Approved'  },
  SENT:      { color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', icon: SendHorizonal, label: 'Sent' },
  FAILED:    { color: 'text-red-400 bg-red-400/10 border-red-400/30',          icon: XCircle,      label: 'Failed'    },
  RETRYING:  { color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', icon: RotateCcw,   label: 'Retrying'  },
  CANCELLED: { color: 'text-muted-foreground bg-muted/20 border-transparent',  icon: Ban,          label: 'Cancelled' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.PENDING;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${cfg.color}`}>
      <Icon className="h-3 w-3" />{cfg.label}
    </Badge>
  );
}

// ─── Billing cycle labels ─────────────────────────────────────────────────────

const CYCLES = [
  { value: 'monthly',  label: 'Monthly',   desc: 'Full calendar month' },
  { value: 'weekly',   label: 'Weekly',    desc: 'Mon–Sun of current week' },
  { value: 'biweekly', label: 'Bi-Weekly', desc: 'Last 2 weeks' },
  { value: 'custom',   label: 'Custom',    desc: 'Choose date range' },
];

function fmt(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Generate Batch Dialog ─────────────────────────────────────────────────────

function GenerateBatchDialog({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen]             = useState(false);
  const [cycle, setCycle]           = useState<string>('monthly');
  const [scope, setScope]           = useState<'all' | 'selected'>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd]   = useState('');
  const [notes, setNotes]           = useState('');
  const [step, setStep]             = useState<1 | 2>(1);
  const [preview, setPreview]       = useState<BatchPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadPreview = async () => {
    setPreviewLoading(true);
    try {
      const body: any = { cycle, scope: { type: scope } };
      if (cycle === 'custom') { body.customStart = customStart; body.customEnd = customEnd; }
      const r = await apiRequest('POST', '/api/invoice-batches/preview', body);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setPreview(data);
      setStep(2);
    } catch (e: any) {
      toast({ title: 'Preview failed', description: e.message, variant: 'destructive' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const generateMutation = useMutation({
    mutationFn: async () => {
      const body: any = { cycle, scope: { type: scope }, notes: notes || undefined };
      if (cycle === 'custom') { body.customStart = customStart; body.customEnd = customEnd; }
      const r = await apiRequest('POST', '/api/invoice-batches', body);
      return r.json();
    },
    onSuccess: (d) => {
      toast({ title: `Batch ${d.batchRef} generated — ${d.jobsCreated} jobs created` });
      setOpen(false);
      reset();
      onSuccess();
    },
    onError: (e: any) => toast({ title: 'Generation failed', description: e.message, variant: 'destructive' }),
  });

  function reset() {
    setStep(1); setPreview(null); setCycle('monthly');
    setScope('all'); setCustomStart(''); setCustomEnd(''); setNotes('');
  }

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-generate-batch">
          <Plus className="h-4 w-4 mr-1.5" />Generate Batch
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Generate Invoice Batch
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-5">
            {/* Step 1: Select billing cycle */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Billing Cycle</Label>
              <div className="grid grid-cols-2 gap-2">
                {CYCLES.map(c => (
                  <button key={c.value} type="button"
                    data-testid={`cycle-${c.value}`}
                    onClick={() => setCycle(c.value)}
                    className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                      cycle === c.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-muted/40'
                    }`}>
                    <div className="font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{c.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {cycle === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">From</Label>
                  <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                    data-testid="input-custom-start" />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">To</Label>
                  <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                    data-testid="input-custom-end" />
                </div>
              </div>
            )}

            {/* Scope */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Scope</Label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" data-testid="scope-all"
                  onClick={() => setScope('all')}
                  className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                    scope === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/40'
                  }`}>
                  <div className="font-medium flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />All Eligible Clients
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">All clients with revenue in period</div>
                </button>
                <button type="button" data-testid="scope-selected"
                  onClick={() => setScope('selected')}
                  className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                    scope === 'selected' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/40'
                  }`}>
                  <div className="font-medium flex items-center gap-1.5">
                    <Search className="h-3.5 w-3.5" />Selected Clients
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Rebill, trial, or credit note</div>
                </button>
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Notes (optional)</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. July 2026 billing cycle — Q3 close"
                className="text-sm resize-none h-16" data-testid="input-batch-notes" />
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={loadPreview} disabled={previewLoading ||
                (cycle === 'custom' && (!customStart || !customEnd))}>
                {previewLoading ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Scanning…</> :
                  <><ArrowRight className="h-4 w-4 mr-1.5" />Preview Batch</>}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && preview && (
          <div className="space-y-4">
            {/* Period summary */}
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Billing Period</p>
                  <p className="text-base font-semibold mt-0.5">{preview.periodLabel}</p>
                  <p className="text-xs text-muted-foreground font-mono">{preview.periodStart} → {preview.periodEnd}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">F3 Reconciliation</p>
                  {preview.reconCertified ? (
                    <Badge variant="outline" className="text-xs gap-1 text-emerald-400 border-emerald-400/30 bg-emerald-400/10 mt-1">
                      <ShieldCheck className="h-3 w-3" />Certified
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1 text-amber-400 border-amber-400/30 bg-amber-400/10 mt-1">
                      <ShieldAlert className="h-3 w-3" />Advisory
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-1 border-t">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Clients Found</p>
                  <p className="text-xl font-bold text-primary">{preview.clientsFound}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Est. Revenue</p>
                  <p className="text-xl font-bold text-emerald-400">{fmt(preview.estimatedRevenue)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Source</p>
                  <p className="text-xs font-mono text-muted-foreground mt-1">
                    {preview.snapshotRunId ? `Snap #${preview.snapshotRunId}` : 'All dates'}
                  </p>
                </div>
              </div>
            </div>

            {/* Client list preview */}
            {preview.clients.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Client</TableHead>
                      <TableHead className="text-xs text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.clients.slice(0, 20).map(c => (
                      <TableRow key={c.accountId} className={!c.eligible ? 'opacity-40' : ''}>
                        <TableCell className="text-xs py-1.5">{c.accountName}</TableCell>
                        <TableCell className="text-xs py-1.5 text-right font-mono">{fmt(c.revenue)}</TableCell>
                      </TableRow>
                    ))}
                    {preview.clients.length > 20 && (
                      <TableRow>
                        <TableCell colSpan={2} className="text-xs text-muted-foreground text-center py-2">
                          +{preview.clients.length - 20} more clients
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Duplicate batch conflict warning */}
            {preview.blocked && preview.existingBatch && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex gap-3 items-start">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-amber-300">Duplicate batch blocked</p>
                  <p className="text-amber-200/80 mt-0.5">
                    <span className="font-mono font-bold">{preview.existingBatch.batchRef}</span>
                    {' '}({preview.existingBatch.status}) already covers this period with{' '}
                    {preview.existingBatch.jobCount} jobs. Cancel it in the Batches tab before re-running.
                  </p>
                </div>
              </div>
            )}

            {!preview.blocked && preview.clientsFound === 0 && (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No eligible clients found for this period.
              </div>
            )}

            <div className="flex gap-2 justify-between pt-1">
              <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending || preview.clientsFound === 0 || preview.blocked}
                  className="bg-emerald-600 hover:bg-emerald-700"
                  data-testid="button-confirm-generate">
                  {generateMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Generating…</>
                    : <><DollarSign className="h-4 w-4 mr-1.5" />Generate {preview.clientsFound} Jobs</>
                  }
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const rejectSchema = z.object({ reason: z.string().min(1, 'Reason required') });

export default function InvoiceJobsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter]         = useState('all');
  const [search, setSearch]         = useState('');
  const [rejectJobId, setRejectJobId]   = useState<number | null>(null);
  const [approveJobId, setApproveJobId] = useState<number | null>(null);
  const [viewTab, setViewTab]           = useState<'jobs' | 'batches'>('jobs');

  const { data: jobs = [], isLoading } = useQuery<InvoiceJob[]>({
    queryKey: ['/api/invoice-jobs'],
    queryFn:  () => apiRequest('GET', '/api/invoice-jobs').then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: batchData, isLoading: batchLoading } = useQuery<{ batches: InvoiceBatch[] }>({
    queryKey: ['/api/invoice-batches'],
    queryFn:  () => apiRequest('GET', '/api/invoice-batches').then(r => r.json()),
    refetchInterval: 60000,
  });
  const batches = batchData?.batches ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/api/invoice-jobs'] });
    qc.invalidateQueries({ queryKey: ['/api/invoice-batches'] });
  };

  const rejectForm = useForm({ resolver: zodResolver(rejectSchema), defaultValues: { reason: '' } });

  const actionMutation = useMutation({
    mutationFn: async ({ jobId, action, body }: { jobId: number; action: string; body?: any }) => {
      const method = action === 'send' ? 'POST' : 'PATCH';
      const r = await apiRequest(method, `/api/invoice-jobs/${jobId}/${action}`, body ?? {});
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? 'Action failed');
      return json;
    },
    onSuccess: (_, vars) => {
      invalidate();
      const labels: Record<string, string> = { review: 'Moved to review', approve: 'Approved — not sent. Use Send when ready.', send: 'Dispatched via billing SMTP', reject: 'Rejected', retry: 'Retrying…', cancel: 'Cancelled' };
      toast({ title: labels[vars.action] ?? 'Done' });
      setRejectJobId(null); setApproveJobId(null);
    },
    onError: (e: any) => toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  });

  const detectMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/invoice-jobs/detect-cycles', {}).then(r => r.json()),
    onSuccess: (d) => { invalidate(); toast({ title: `Detected ${d.detected?.length ?? 0} clients — created ${d.created} jobs, skipped ${d.skipped}` }); },
    onError:   (e: any) => toast({ title: 'Detection failed', description: e.message, variant: 'destructive' }),
  });

  const filtered = jobs.filter(j => {
    const matchStatus = filter === 'all' || j.status === filter.toUpperCase();
    const matchSearch = !search || j.clientName.toLowerCase().includes(search.toLowerCase()) || j.billingPeriod.includes(search);
    return matchStatus && matchSearch;
  });

  const counts = {
    PENDING:  jobs.filter(j => j.status === 'PENDING').length,
    REVIEW:   jobs.filter(j => j.status === 'REVIEW').length,
    SENT:     jobs.filter(j => j.status === 'SENT').length,
    FAILED:   jobs.filter(j => j.status === 'FAILED' || j.status === 'RETRYING').length,
  };

  // Build batchRef lookup
  const batchRefById: Record<number, string> = {};
  batches.forEach(b => { batchRefById[b.id] = b.batchRef; });

  return (
    <TooltipProvider>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <SendHorizonal className="h-6 w-6 text-primary" />
              Invoice Delivery Queue
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Period-first billing — generate batch → review → approve → send
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" data-testid="button-detect-cycles"
              onClick={() => detectMutation.mutate()} disabled={detectMutation.isPending}>
              <Search className="h-4 w-4 mr-1.5" />
              {detectMutation.isPending ? 'Detecting…' : 'Detect Cycles'}
            </Button>
            <GenerateBatchDialog onSuccess={invalidate} />
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending',   count: counts.PENDING, color: 'text-slate-400',   status: 'pending'  },
            { label: 'In Review', count: counts.REVIEW,  color: 'text-amber-400',   status: 'review'   },
            { label: 'Sent',      count: counts.SENT,    color: 'text-emerald-400', status: 'sent'     },
            { label: 'Failed',    count: counts.FAILED,  color: 'text-red-400',     status: 'failed'   },
          ].map(s => (
            <Card key={s.label} className={`cursor-pointer transition-colors ${filter === s.status ? 'ring-2 ring-primary' : 'hover:bg-muted/30'}`}
              onClick={() => setFilter(filter === s.status ? 'all' : s.status)}
              data-testid={`stat-${s.status}`}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs: Jobs | Batches */}
        <Tabs value={viewTab} onValueChange={v => setViewTab(v as any)}>
          <TabsList className="h-9 mb-4">
            <TabsTrigger value="jobs" className="text-sm">Invoice Jobs</TabsTrigger>
            <TabsTrigger value="batches" className="text-sm">
              Batches {batches.length > 0 && <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">{batches.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── Jobs tab ────────────────────────────────────────────────────── */}
          <TabsContent value="jobs">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search client or period…" className="pl-8" value={search}
                      onChange={e => setSearch(e.target.value)} data-testid="input-search" />
                  </div>
                  <Tabs value={filter} onValueChange={setFilter}>
                    <TabsList className="h-8">
                      {['all','pending','review','approved','sent','failed','cancelled'].map(s => (
                        <TabsTrigger key={s} value={s} className="text-xs capitalize">{s}</TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Last Activity</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                    )}
                    {!isLoading && filtered.length === 0 && (
                      <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                        No invoice jobs found. Use "Generate Batch" to start a billing run.
                      </TableCell></TableRow>
                    )}
                    {filtered.map((job, i) => (
                      <TableRow key={job.id} data-testid={`row-job-${job.id}`}
                        className={job.status === 'FAILED' ? 'bg-red-500/5' : job.status === 'REVIEW' ? 'bg-amber-500/5' : ''}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          {job.batchId && batchRefById[job.batchId] ? (
                            <button onClick={() => setViewTab('batches')}
                              className="font-mono text-xs text-primary hover:underline">
                              {batchRefById[job.batchId]}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{job.clientName}</div>
                          {job.notes && <div className="text-xs text-muted-foreground truncate max-w-[180px]">{job.notes}</div>}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{job.billingPeriod}</TableCell>
                        <TableCell>
                          <StatusBadge status={job.status} />
                          {job.lastError && job.status === 'FAILED' && (
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="h-3.5 w-3.5 text-red-400 ml-1.5 inline" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">{job.lastError}</TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {job.invoiceId ? <span className="text-blue-400">#{job.invoiceId}</span> : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {job.retryCount > 0 ? <span className="text-orange-400">{job.retryCount}×</span> : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {job.sentAt     ? `Sent ${new Date(job.sentAt).toLocaleDateString()}`     :
                           job.failedAt   ? `Failed ${new Date(job.failedAt).toLocaleDateString()}` :
                           job.approvedAt ? `Approved ${new Date(job.approvedAt).toLocaleDateString()}` :
                           `Created ${new Date(job.createdAt).toLocaleDateString()}`}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            {(job.status === 'PENDING' || job.status === 'GENERATED') && (
                              <Button size="sm" variant="outline" className="h-7 text-xs"
                                data-testid={`button-review-${job.id}`}
                                onClick={() => actionMutation.mutate({ jobId: job.id, action: 'review' })}
                                disabled={actionMutation.isPending}>
                                <ChevronRight className="h-3 w-3 mr-1" />Review
                              </Button>
                            )}
                            {job.status === 'REVIEW' && (
                              <>
                                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                                  data-testid={`button-approve-${job.id}`}
                                  onClick={() => setApproveJobId(job.id)} disabled={actionMutation.isPending}>
                                  <ThumbsUp className="h-3 w-3 mr-1" />Approve
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                                  data-testid={`button-reject-${job.id}`}
                                  onClick={() => { setRejectJobId(job.id); rejectForm.reset(); }}
                                  disabled={actionMutation.isPending}>
                                  <ThumbsDown className="h-3 w-3 mr-1" />Reject
                                </Button>
                              </>
                            )}
                            {job.status === 'APPROVED' && (
                              <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                                data-testid={`button-send-${job.id}`}
                                onClick={() => actionMutation.mutate({ jobId: job.id, action: 'send' })}
                                disabled={actionMutation.isPending}>
                                <SendHorizonal className="h-3 w-3 mr-1" />Send
                              </Button>
                            )}
                            {(job.status === 'FAILED' || job.status === 'RETRYING') && job.retryCount < 3 && (
                              <Button size="sm" variant="outline" className="h-7 text-xs"
                                data-testid={`button-retry-${job.id}`}
                                onClick={() => actionMutation.mutate({ jobId: job.id, action: 'retry' })}
                                disabled={actionMutation.isPending}>
                                <RotateCcw className="h-3 w-3 mr-1" />Retry
                              </Button>
                            )}
                            {!['SENT','CANCELLED'].includes(job.status) && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-red-400"
                                data-testid={`button-cancel-${job.id}`}
                                onClick={() => actionMutation.mutate({ jobId: job.id, action: 'cancel' })}
                                disabled={actionMutation.isPending}>
                                <Ban className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Batches tab ─────────────────────────────────────────────────── */}
          <TabsContent value="batches">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  Billing Batch History
                </CardTitle>
                <CardDescription>One batch per billing period run. Each batch spawns invoice jobs for eligible clients.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch</TableHead>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Clients</TableHead>
                      <TableHead>Est. Revenue</TableHead>
                      <TableHead>Jobs</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchLoading && (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                    )}
                    {!batchLoading && batches.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                        No batches yet. Click "Generate Batch" to run the first billing period.
                      </TableCell></TableRow>
                    )}
                    {batches.map(b => (
                      <TableRow key={b.id} data-testid={`row-batch-${b.id}`}>
                        <TableCell>
                          <div className="font-mono text-sm font-medium text-primary">{b.batchRef}</div>
                          <div className="text-xs text-muted-foreground capitalize">{b.scope}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">{b.billingCycle}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{b.periodLabel}</div>
                          <div className="text-xs text-muted-foreground font-mono">{b.periodStart} → {b.periodEnd}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-bold">{b.clientsFound}</div>
                          {Number(b.failed_jobs) > 0 && (
                            <div className="text-xs text-red-400">{b.failed_jobs} failed</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-emerald-400">
                          {b.estimatedRevenue ? `$${parseFloat(b.estimatedRevenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs">
                            <span className="text-emerald-400">{b.sent_jobs ?? 0} sent</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="text-muted-foreground">{b.total_jobs ?? b.clientsFound} total</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(b.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Approve confirm dialog */}
        <AlertDialog open={approveJobId != null} onOpenChange={() => setApproveJobId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve Invoice</AlertDialogTitle>
              <AlertDialogDescription>
                This marks the job (and its invoice) approved. Nothing is emailed — use the Send button on the approved job to dispatch it to the client's billing contact.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => approveJobId && actionMutation.mutate({ jobId: approveJobId, action: 'approve' })}>
                Approve
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reject dialog */}
        <AlertDialog open={rejectJobId != null} onOpenChange={() => setRejectJobId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject Invoice Job</AlertDialogTitle>
              <AlertDialogDescription>Provide a reason for rejection.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="px-6 pb-2">
              <Input data-testid="input-reject-reason"
                placeholder="Explain why this job is being rejected…"
                onKeyDown={e => {
                  if (e.key === 'Enter' && rejectJobId) {
                    actionMutation.mutate({ jobId: rejectJobId, action: 'reject', body: { reason: (e.target as any).value } });
                  }
                }} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setRejectJobId(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  const el = document.querySelector('[data-testid="input-reject-reason"]') as HTMLInputElement;
                  if (rejectJobId) actionMutation.mutate({ jobId: rejectJobId, action: 'reject', body: { reason: el?.value ?? '' } });
                }}>
                Reject
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </TooltipProvider>
  );
}
