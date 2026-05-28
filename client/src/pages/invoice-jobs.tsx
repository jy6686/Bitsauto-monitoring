import { useState } from "react";
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
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
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SendHorizonal, Clock, CheckCircle2, XCircle, RefreshCw, Plus,
  Search, FileText, ChevronRight, AlertTriangle, Zap, Play, Ban,
  ThumbsUp, ThumbsDown, RotateCcw,
} from "lucide-react";

interface InvoiceJob {
  id:            number;
  clientName:    string;
  clientId?:     string;
  billingPeriod: string;
  invoiceId?:    number;
  status:        string;
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

const STATUS_CFG: Record<string, { color: string; icon: any; label: string }> = {
  PENDING:   { color: 'text-slate-400 bg-slate-400/10 border-slate-400/30',   icon: Clock,        label: 'Pending'   },
  GENERATED: { color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',      icon: FileText,     label: 'Generated' },
  REVIEW:    { color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',   icon: AlertTriangle, label: 'Review'   },
  APPROVED:  { color: 'text-purple-400 bg-purple-400/10 border-purple-400/30', icon: CheckCircle2, label: 'Approved'  },
  SENT:      { color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', icon: SendHorizonal, label: 'Sent' },
  FAILED:    { color: 'text-red-400 bg-red-400/10 border-red-400/30',         icon: XCircle,      label: 'Failed'    },
  RETRYING:  { color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', icon: RotateCcw,   label: 'Retrying'  },
  CANCELLED: { color: 'text-muted-foreground bg-muted/20 border-transparent', icon: Ban,          label: 'Cancelled' },
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

const createSchema = z.object({
  clientName:    z.string().min(1, 'Client name required'),
  billingPeriod: z.string().regex(/^\d{4}-\d{2}$/, 'Format: YYYY-MM'),
  notes:         z.string().optional(),
});

const rejectSchema = z.object({ reason: z.string().min(1, 'Reason required') });

export default function InvoiceJobsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [rejectJobId, setRejectJobId] = useState<number | null>(null);
  const [approveJobId, setApproveJobId] = useState<number | null>(null);

  const { data: jobs = [], isLoading } = useQuery<InvoiceJob[]>({
    queryKey: ['/api/invoice-jobs'],
    queryFn:  () => apiRequest('GET', '/api/invoice-jobs').then(r => r.json()),
    refetchInterval: 30000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/api/invoice-jobs'] });

  const createForm = useForm({ resolver: zodResolver(createSchema), defaultValues: { clientName: '', billingPeriod: new Date().toISOString().slice(0, 7), notes: '' } });
  const rejectForm = useForm({ resolver: zodResolver(rejectSchema), defaultValues: { reason: '' } });

  const createMutation = useMutation({
    mutationFn: (d: any) => apiRequest('POST', '/api/invoice-jobs', d).then(r => r.json()),
    onSuccess: () => { invalidate(); setCreateOpen(false); createForm.reset(); toast({ title: 'Job created' }); },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ jobId, action, body }: { jobId: number; action: string; body?: any }) =>
      apiRequest('PATCH', `/api/invoice-jobs/${jobId}/${action}`, body ?? {}).then(r => r.json()),
    onSuccess: (_, vars) => {
      invalidate();
      const labels: Record<string, string> = { review: 'Moved to review', approve: 'Approved — dispatching…', reject: 'Rejected', retry: 'Retrying…', cancel: 'Cancelled' };
      toast({ title: labels[vars.action] ?? 'Done' });
      setRejectJobId(null);
      setApproveJobId(null);
    },
    onError: (e: any) => toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  });

  const detectMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/invoice-jobs/detect-cycles', {}).then(r => r.json()),
    onSuccess: (d) => { invalidate(); toast({ title: `Detected ${d.detected?.length ?? 0} clients — created ${d.created} jobs, skipped ${d.skipped}` }); },
    onError: (e: any) => toast({ title: 'Detection failed', description: e.message, variant: 'destructive' }),
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
              Finance approval queue — draft generation, review, approval and SMTP dispatch
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" data-testid="button-detect-cycles"
              onClick={() => detectMutation.mutate()} disabled={detectMutation.isPending}>
              <Search className="h-4 w-4 mr-1.5" />
              {detectMutation.isPending ? 'Detecting…' : 'Detect Cycles'}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-new-job">
                  <Plus className="h-4 w-4 mr-1.5" />New Job
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Invoice Job</DialogTitle>
                </DialogHeader>
                <Form {...createForm}>
                  <form onSubmit={createForm.handleSubmit(d => createMutation.mutate(d))} className="space-y-4">
                    <FormField control={createForm.control} name="clientName" render={({ field }) => (
                      <FormItem><FormLabel>Client Name</FormLabel>
                        <FormControl><Input data-testid="input-client-name" placeholder="Acme Telecom" {...field} /></FormControl>
                        <FormMessage /></FormItem>
                    )} />
                    <FormField control={createForm.control} name="billingPeriod" render={({ field }) => (
                      <FormItem><FormLabel>Billing Period</FormLabel>
                        <FormControl><Input data-testid="input-billing-period" type="month" {...field} /></FormControl>
                        <FormMessage /></FormItem>
                    )} />
                    <FormField control={createForm.control} name="notes" render={({ field }) => (
                      <FormItem><FormLabel>Notes (optional)</FormLabel>
                        <FormControl><Input data-testid="input-notes" placeholder="Any notes for finance team…" {...field} /></FormControl>
                        <FormMessage /></FormItem>
                    )} />
                    <div className="flex gap-2 justify-end pt-2">
                      <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={createMutation.isPending}>
                        {createMutation.isPending ? 'Creating…' : 'Create Job'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending',     count: counts.PENDING, color: 'text-slate-400',   status: 'pending'  },
            { label: 'In Review',   count: counts.REVIEW,  color: 'text-amber-400',   status: 'review'   },
            { label: 'Sent',        count: counts.SENT,    color: 'text-emerald-400', status: 'sent'     },
            { label: 'Failed',      count: counts.FAILED,  color: 'text-red-400',     status: 'failed'   },
          ].map(s => (
            <Card key={s.label} className={`cursor-pointer transition-colors ${filter === s.status ? 'ring-2 ring-primary' : 'hover:bg-muted/30'}`}
              onClick={() => setFilter(filter === s.status ? 'all' : s.status)} data-testid={`stat-${s.status}`}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search + table */}
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
                  {['all', 'pending', 'review', 'approved', 'sent', 'failed', 'cancelled'].map(s => (
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
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    No invoice jobs yet. Click "New Job" or "Detect Cycles" to get started.
                  </TableCell></TableRow>
                )}
                {filtered.map((job, i) => (
                  <TableRow key={job.id} data-testid={`row-job-${job.id}`} className={job.status === 'FAILED' ? 'bg-red-500/5' : job.status === 'REVIEW' ? 'bg-amber-500/5' : ''}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{job.clientName}</div>
                      {job.notes && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{job.notes}</div>}
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
                      {job.sentAt ? `Sent ${new Date(job.sentAt).toLocaleDateString()}` :
                        job.failedAt ? `Failed ${new Date(job.failedAt).toLocaleDateString()}` :
                        job.approvedAt ? `Approved ${new Date(job.approvedAt).toLocaleDateString()}` :
                        `Created ${new Date(job.createdAt).toLocaleDateString()}`}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        {/* PENDING → Review */}
                        {(job.status === 'PENDING' || job.status === 'GENERATED') && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            data-testid={`button-review-${job.id}`}
                            onClick={() => actionMutation.mutate({ jobId: job.id, action: 'review' })}
                            disabled={actionMutation.isPending}>
                            <ChevronRight className="h-3 w-3 mr-1" />Review
                          </Button>
                        )}
                        {/* REVIEW → Approve */}
                        {job.status === 'REVIEW' && (
                          <>
                            <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                              data-testid={`button-approve-${job.id}`}
                              onClick={() => setApproveJobId(job.id)}
                              disabled={actionMutation.isPending}>
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
                        {/* FAILED/RETRYING → Retry */}
                        {(job.status === 'FAILED' || job.status === 'RETRYING') && job.retryCount < 3 && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            data-testid={`button-retry-${job.id}`}
                            onClick={() => actionMutation.mutate({ jobId: job.id, action: 'retry' })}
                            disabled={actionMutation.isPending}>
                            <RotateCcw className="h-3 w-3 mr-1" />Retry
                          </Button>
                        )}
                        {/* Cancel */}
                        {!['SENT', 'CANCELLED'].includes(job.status) && (
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

        {/* Approve confirm dialog */}
        <AlertDialog open={approveJobId != null} onOpenChange={() => setApproveJobId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve & Dispatch Invoice</AlertDialogTitle>
              <AlertDialogDescription>
                This will mark the job approved and immediately trigger SMTP delivery via the configured billing sender profile. Confirm?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => approveJobId && actionMutation.mutate({ jobId: approveJobId, action: 'approve' })}>
                Approve & Send
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reject dialog */}
        <Dialog open={rejectJobId != null} onOpenChange={() => setRejectJobId(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Reject Job</DialogTitle></DialogHeader>
            <Form {...rejectForm}>
              <form onSubmit={rejectForm.handleSubmit(d => rejectJobId && actionMutation.mutate({ jobId: rejectJobId, action: 'reject', body: { reason: d.reason } }))} className="space-y-4">
                <FormField control={rejectForm.control} name="reason" render={({ field }) => (
                  <FormItem><FormLabel>Rejection Reason</FormLabel>
                    <FormControl><Input data-testid="input-reject-reason" placeholder="Explain why this job is being rejected…" {...field} /></FormControl>
                    <FormMessage /></FormItem>
                )} />
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setRejectJobId(null)}>Cancel</Button>
                  <Button type="submit" variant="destructive">Reject</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
