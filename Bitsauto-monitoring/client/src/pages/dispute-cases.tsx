import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Shield, Plus, Search, Clock, CheckCircle2, XCircle, AlertTriangle,
  ChevronRight, User, FileText, Activity, ExternalLink, MessageSquare,
  TrendingDown, Radio, Route, GitBranch, ArrowRight, Timer, SlidersHorizontal,
} from "lucide-react";

interface DisputeCase {
  id:               number;
  referenceId:      string;
  disputeType:      string;
  clientName:       string;
  clientId?:        string;
  billingPeriod?:   string;
  invoiceId?:       number;
  reconciliationId?: number;
  assignedTo?:      string;
  severity:         string;
  status:           string;
  disputedAmount?:  number;
  resolvedAmount?:  number;
  description?:     string;
  internalNotes?:   string;
  slaHours:         number;
  slaDueAt?:        string;
  openedAt:         string;
  resolvedAt?:      string;
  closedAt?:        string;
  createdAt:        string;
}

interface CaseDetail extends DisputeCase {
  events:             CaseEvent[];
  slaStatus:          string;
  slaRemainingH?:     number | null;
  allowedTransitions: string[];
  linkedInvoice?:     any;
  linkedReconciliation?: any;
}

interface CaseEvent {
  id:          number;
  eventType:   string;
  fromStatus?: string;
  toStatus?:   string;
  message?:    string;
  actorName?:  string;
  createdAt:   string;
}

const STATUS_CFG: Record<string, { color: string; label: string; icon: any }> = {
  OPEN:             { color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',       label: 'Open',             icon: Activity     },
  INVESTIGATING:    { color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',    label: 'Investigating',    icon: Search       },
  CUSTOMER_PENDING: { color: 'text-purple-400 bg-purple-400/10 border-purple-400/30', label: 'Customer Pending', icon: Clock        },
  RESOLVED:         { color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', label: 'Resolved',      icon: CheckCircle2 },
  CREDIT_ISSUED:    { color: 'text-teal-400 bg-teal-400/10 border-teal-400/30',       label: 'Credit Issued',    icon: CheckCircle2 },
  REJECTED:         { color: 'text-red-400 bg-red-400/10 border-red-400/30',          label: 'Rejected',         icon: XCircle      },
  CLOSED:           { color: 'text-muted-foreground bg-muted/20 border-transparent',  label: 'Closed',           icon: XCircle      },
};

const SEVERITY_CFG: Record<string, string> = {
  low:      'text-sky-400 bg-sky-400/10 border-sky-400/30',
  medium:   'text-amber-400 bg-amber-400/10 border-amber-400/30',
  high:     'text-orange-400 bg-orange-400/10 border-orange-400/30',
  critical: 'text-red-400 bg-red-400/10 border-red-400/30',
};

const DISPUTE_TYPES = [
  { value: 'billing_dispute',         label: 'Billing Dispute',         icon: FileText      },
  { value: 'rate_dispute',            label: 'Rate Dispute',            icon: TrendingDown  },
  { value: 'qos_dispute',             label: 'QoS Dispute',             icon: Radio         },
  { value: 'routing_dispute',         label: 'Routing Dispute',         icon: Route         },
  { value: 'reconciliation_dispute',  label: 'Reconciliation Dispute',  icon: GitBranch     },
];

const TRANSITION_LABELS: Record<string, { label: string; color: string }> = {
  INVESTIGATING:    { label: 'Start Investigating',   color: 'bg-amber-600 hover:bg-amber-700 text-white' },
  CUSTOMER_PENDING: { label: 'Awaiting Customer',     color: 'bg-purple-600 hover:bg-purple-700 text-white' },
  RESOLVED:         { label: 'Mark Resolved',         color: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
  CREDIT_ISSUED:    { label: 'Issue Credit',          color: 'bg-teal-600 hover:bg-teal-700 text-white' },
  REJECTED:         { label: 'Reject Case',           color: 'bg-red-600 hover:bg-red-700 text-white' },
  CLOSED:           { label: 'Close Case',            color: 'bg-muted text-muted-foreground hover:bg-muted/80' },
  OPEN:             { label: 'Re-open',               color: 'bg-blue-600 hover:bg-blue-700 text-white' },
};

const EVENT_ICON: Record<string, any> = {
  status_change: ArrowRight,
  note:          MessageSquare,
  assignment:    User,
  escalation:    AlertTriangle,
};

const openSchema = z.object({
  disputeType:    z.string().min(1),
  clientName:     z.string().min(1, 'Client name required'),
  billingPeriod:  z.string().regex(/^\d{4}-\d{2}$/, 'Format: YYYY-MM').optional().or(z.literal('')),
  severity:       z.enum(['low', 'medium', 'high', 'critical']),
  disputedAmount: z.string().optional(),
  description:    z.string().optional(),
  assignedTo:     z.string().optional(),
});

function SlaChip({ slaStatus, slaRemainingH }: { slaStatus: string; slaRemainingH?: number | null }) {
  if (slaStatus === 'breached') return <Badge variant="outline" className="text-xs text-red-400 border-red-400/30 bg-red-400/10 gap-1"><Timer className="h-3 w-3" />SLA Breached</Badge>;
  if (slaStatus === 'at_risk') return <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30 bg-amber-400/10 gap-1"><Timer className="h-3 w-3" />{slaRemainingH != null ? `${Math.round(slaRemainingH)}h left` : 'At Risk'}</Badge>;
  return null;
}

export default function DisputeCasesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const [assignTo, setAssignTo] = useState('');

  const { data: cases = [], isLoading } = useQuery<DisputeCase[]>({
    queryKey: ['/api/dispute-cases'],
    queryFn:  () => apiRequest('GET', '/api/dispute-cases').then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: detail } = useQuery<CaseDetail>({
    queryKey: ['/api/dispute-cases', selectedId],
    queryFn:  () => apiRequest('GET', `/api/dispute-cases/${selectedId}`).then(r => r.json()),
    enabled:  selectedId != null,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/api/dispute-cases'] });
    if (selectedId) qc.invalidateQueries({ queryKey: ['/api/dispute-cases', selectedId] });
  };

  const openForm = useForm({
    resolver: zodResolver(openSchema),
    defaultValues: { disputeType: 'billing_dispute', clientName: '', billingPeriod: '', severity: 'medium', disputedAmount: '', description: '', assignedTo: '' },
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => apiRequest('POST', '/api/dispute-cases', {
      ...d,
      disputedAmount: d.disputedAmount ? parseFloat(d.disputedAmount) : undefined,
      billingPeriod: d.billingPeriod || undefined,
    }).then(r => r.json()),
    onSuccess: (d) => { invalidate(); setCreateOpen(false); openForm.reset(); toast({ title: `Case ${d.referenceId} opened` }); },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const transitionMutation = useMutation({
    mutationFn: ({ caseId, toStatus, message }: { caseId: number; toStatus: string; message?: string }) =>
      apiRequest('PATCH', `/api/dispute-cases/${caseId}/status`, { toStatus, message }).then(r => r.json()),
    onSuccess: () => { invalidate(); toast({ title: 'Status updated' }); },
    onError: (e: any) => toast({ title: 'Transition failed', description: e.message, variant: 'destructive' }),
  });

  const noteMutation = useMutation({
    mutationFn: ({ caseId, message }: { caseId: number; message: string }) =>
      apiRequest('POST', `/api/dispute-cases/${caseId}/notes`, { message }).then(r => r.json()),
    onSuccess: () => { invalidate(); setNoteText(''); toast({ title: 'Note added' }); },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ caseId, assignedTo }: { caseId: number; assignedTo: string }) =>
      apiRequest('PATCH', `/api/dispute-cases/${caseId}/assign`, { assignedTo }).then(r => r.json()),
    onSuccess: () => { invalidate(); setAssignTo(''); toast({ title: 'Assigned' }); },
    onError: (e: any) => toast({ title: 'Assignment failed', description: e.message, variant: 'destructive' }),
  });

  const ACTIVE_STATUSES = new Set(['OPEN', 'INVESTIGATING', 'CUSTOMER_PENDING']);
  const filtered = cases.filter(c => {
    const matchStatus = statusFilter === 'all' ? true : statusFilter === 'active' ? ACTIVE_STATUSES.has(c.status) : statusFilter === 'resolved' ? ['RESOLVED', 'CREDIT_ISSUED', 'CLOSED'].includes(c.status) : c.status === statusFilter.toUpperCase();
    const matchSearch = !search || c.clientName.toLowerCase().includes(search.toLowerCase()) || c.referenceId.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const counts = {
    active:   cases.filter(c => ACTIVE_STATUSES.has(c.status)).length,
    review:   cases.filter(c => c.status === 'CUSTOMER_PENDING').length,
    resolved: cases.filter(c => ['RESOLVED', 'CREDIT_ISSUED'].includes(c.status)).length,
    total:    cases.length,
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Dispute Cases
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Telecom finance case management — assignment, SLA tracking, evidence, resolution
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-open-case"><Plus className="h-4 w-4 mr-1.5" />Open Case</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Open Dispute Case</DialogTitle></DialogHeader>
            <Form {...openForm}>
              <form onSubmit={openForm.handleSubmit(d => createMutation.mutate(d))} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={openForm.control} name="disputeType" render={({ field }) => (
                    <FormItem className="col-span-2"><FormLabel>Dispute Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger data-testid="select-dispute-type"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {DISPUTE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={openForm.control} name="clientName" render={({ field }) => (
                    <FormItem className="col-span-2"><FormLabel>Client Name</FormLabel>
                      <FormControl><Input data-testid="input-client-name" placeholder="Acme Telecom" {...field} /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={openForm.control} name="billingPeriod" render={({ field }) => (
                    <FormItem><FormLabel>Billing Period</FormLabel>
                      <FormControl><Input data-testid="input-billing-period" type="month" {...field} /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={openForm.control} name="severity" render={({ field }) => (
                    <FormItem><FormLabel>Severity</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger data-testid="select-severity"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {['low', 'medium', 'high', 'critical'].map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={openForm.control} name="disputedAmount" render={({ field }) => (
                    <FormItem><FormLabel>Disputed Amount ($)</FormLabel>
                      <FormControl><Input data-testid="input-disputed-amount" type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={openForm.control} name="assignedTo" render={({ field }) => (
                    <FormItem><FormLabel>Assign To</FormLabel>
                      <FormControl><Input data-testid="input-assigned-to" placeholder="Finance team member…" {...field} /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={openForm.control} name="description" render={({ field }) => (
                    <FormItem className="col-span-2"><FormLabel>Description</FormLabel>
                      <FormControl><Textarea data-testid="input-description" placeholder="Describe the dispute…" rows={3} {...field} /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Opening…' : 'Open Case'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active Cases',   count: counts.active,   color: 'text-blue-400',    filter: 'active'   },
          { label: 'Customer Pending', count: counts.review, color: 'text-purple-400',  filter: 'customer_pending' },
          { label: 'Resolved',       count: counts.resolved, color: 'text-emerald-400', filter: 'resolved' },
          { label: 'Total Cases',    count: counts.total,    color: 'text-muted-foreground', filter: 'all' },
        ].map(s => (
          <Card key={s.label} className={`cursor-pointer transition-colors ${statusFilter === s.filter ? 'ring-2 ring-primary' : 'hover:bg-muted/30'}`}
            onClick={() => setStatusFilter(s.filter)} data-testid={`stat-${s.filter}`}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table + detail panel */}
      <div className="flex gap-4">
        <Card className="flex-1 min-w-0">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search cases…" className="pl-8" value={search}
                  onChange={e => setSearch(e.target.value)} data-testid="input-search" />
              </div>
              <div className="flex gap-1">
                {['all', 'active', 'resolved'].map(s => (
                  <Button key={s} size="sm" variant={statusFilter === s ? 'default' : 'outline'} className="h-8 text-xs capitalize"
                    onClick={() => setStatusFilter(s)}>{s}</Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    No dispute cases. Click "Open Case" to create one.
                  </TableCell></TableRow>
                )}
                {filtered.map(c => {
                  const scfg = STATUS_CFG[c.status] ?? STATUS_CFG.OPEN;
                  const Icon = scfg.icon;
                  const typeLabel = DISPUTE_TYPES.find(t => t.value === c.disputeType)?.label ?? c.disputeType;
                  const slaBreached = c.slaDueAt && new Date(c.slaDueAt) < new Date() && !['RESOLVED', 'CREDIT_ISSUED', 'REJECTED', 'CLOSED'].includes(c.status);
                  return (
                    <TableRow key={c.id} data-testid={`row-case-${c.id}`}
                      className={`cursor-pointer transition-colors ${selectedId === c.id ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : 'hover:bg-muted/30'} ${slaBreached ? 'bg-red-500/5' : ''}`}
                      onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}>
                      <TableCell className="font-mono text-xs font-bold text-primary">{c.referenceId}</TableCell>
                      <TableCell className="font-medium text-sm">{c.clientName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{typeLabel}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${SEVERITY_CFG[c.severity]}`}>{c.severity}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs gap-1 ${scfg.color}`}>
                          <Icon className="h-3 w-3" />{scfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {c.disputedAmount != null ? `$${c.disputedAmount.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.assignedTo ?? '—'}</TableCell>
                      <TableCell>
                        {slaBreached && <Badge variant="outline" className="text-xs text-red-400 border-red-400/30 gap-1"><Timer className="h-3 w-3" />Breached</Badge>}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${selectedId === c.id ? 'rotate-90' : ''}`} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Case Detail Sheet */}
      <Sheet open={selectedId != null} onOpenChange={o => !o && setSelectedId(null)}>
        <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
          {detail && (
            <>
              <SheetHeader className="pb-4 border-b">
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-base font-mono text-primary">{detail.referenceId}</SheetTitle>
                  <div className="flex items-center gap-2">
                    <SlaChip slaStatus={detail.slaStatus} slaRemainingH={detail.slaRemainingH} />
                    <Badge variant="outline" className={`text-xs ${SEVERITY_CFG[detail.severity]}`}>{detail.severity}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {(() => { const scfg = STATUS_CFG[detail.status] ?? STATUS_CFG.OPEN; const Icon = scfg.icon; return <Badge variant="outline" className={`text-xs gap-1 ${scfg.color}`}><Icon className="h-3 w-3" />{scfg.label}</Badge>; })()}
                  <span className="text-xs text-muted-foreground">{detail.clientName}</span>
                  {detail.billingPeriod && <span className="text-xs font-mono text-muted-foreground">· {detail.billingPeriod}</span>}
                </div>
              </SheetHeader>

              <div className="py-4 space-y-4">
                {/* Description */}
                {detail.description && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                    <p className="text-sm">{detail.description}</p>
                  </div>
                )}

                {/* Financials */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/30 rounded p-3">
                    <p className="text-xs text-muted-foreground">Disputed Amount</p>
                    <p className="text-lg font-bold text-red-400">{detail.disputedAmount != null ? `$${detail.disputedAmount.toFixed(2)}` : '—'}</p>
                  </div>
                  <div className="bg-muted/30 rounded p-3">
                    <p className="text-xs text-muted-foreground">Resolved Amount</p>
                    <p className="text-lg font-bold text-emerald-400">{detail.resolvedAmount != null ? `$${detail.resolvedAmount.toFixed(2)}` : '—'}</p>
                  </div>
                </div>

                {/* Status transitions */}
                {detail.allowedTransitions.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Status Actions</p>
                    <div className="flex flex-wrap gap-2">
                      {detail.allowedTransitions.map(t => {
                        const cfg = TRANSITION_LABELS[t] ?? { label: t, color: 'bg-muted text-muted-foreground' };
                        return (
                          <Button key={t} size="sm" className={`text-xs h-7 ${cfg.color}`}
                            data-testid={`button-transition-${t.toLowerCase()}`}
                            onClick={() => transitionMutation.mutate({ caseId: detail.id, toStatus: t })}
                            disabled={transitionMutation.isPending}>
                            {cfg.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Assign */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    <User className="inline h-3 w-3 mr-1" />Assignment
                    {detail.assignedTo && <span className="ml-2 font-normal">→ {detail.assignedTo}</span>}
                  </p>
                  <div className="flex gap-2">
                    <Input value={assignTo} onChange={e => setAssignTo(e.target.value)} placeholder="Assign to…" className="h-8 text-xs" data-testid="input-assign-to" />
                    <Button size="sm" className="h-8" onClick={() => assignMutation.mutate({ caseId: detail.id, assignedTo: assignTo })}
                      disabled={!assignTo.trim() || assignMutation.isPending}>Assign</Button>
                  </div>
                </div>

                {/* Linked evidence */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Evidence Links</p>
                  <div className="flex flex-col gap-1.5">
                    {detail.invoiceId && (
                      <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-400/10 rounded px-3 py-1.5">
                        <FileText className="h-3.5 w-3.5" />Invoice #{detail.invoiceId}
                      </div>
                    )}
                    {detail.reconciliationId && (
                      <div className="flex items-center gap-2 text-xs text-purple-400 bg-purple-400/10 rounded px-3 py-1.5">
                        <Activity className="h-3.5 w-3.5" />Reconciliation #{detail.reconciliationId}
                      </div>
                    )}
                    {/* Defense package link */}
                    {detail.billingPeriod && (
                      <Button variant="outline" size="sm" className="h-8 text-xs justify-start gap-2 border-primary/30 text-primary"
                        data-testid="button-defense-package"
                        onClick={() => {
                          setSelectedId(null);
                          navigate(`/dispute-defense?client=${encodeURIComponent(detail.clientName)}&period=${detail.billingPeriod}`);
                        }}>
                        <Shield className="h-3.5 w-3.5" />
                        Generate Defense Package
                        <ExternalLink className="h-3 w-3 ml-auto" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Add note */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2"><MessageSquare className="inline h-3 w-3 mr-1" />Add Note</p>
                  <div className="space-y-2">
                    <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a case note…" rows={2} className="text-xs" data-testid="input-note" />
                    <Button size="sm" className="h-7 text-xs" onClick={() => selectedId && noteMutation.mutate({ caseId: selectedId, message: noteText })}
                      disabled={!noteText.trim() || noteMutation.isPending}>Add Note</Button>
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3">
                    <Activity className="inline h-3 w-3 mr-1" />Timeline
                  </p>
                  <div className="space-y-2">
                    {detail.events.length === 0 && <p className="text-xs text-muted-foreground">No events yet.</p>}
                    {[...detail.events].reverse().map(ev => {
                      const Icon = EVENT_ICON[ev.eventType] ?? Activity;
                      return (
                        <div key={ev.id} className="flex gap-3 text-xs" data-testid={`event-${ev.id}`}>
                          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center mt-0.5">
                            <Icon className="h-3 w-3 text-muted-foreground" />
                          </div>
                          <div className="flex-1 pb-2 border-b border-muted/20">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{ev.actorName ?? 'System'}</span>
                              <span className="text-muted-foreground">{new Date(ev.createdAt).toLocaleString()}</span>
                            </div>
                            {ev.fromStatus && ev.toStatus && (
                              <span className="text-muted-foreground">{ev.fromStatus} → <span className="text-foreground">{ev.toStatus}</span></span>
                            )}
                            {ev.message && <p className="text-muted-foreground mt-0.5">{ev.message}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
          {!detail && selectedId && (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading case…</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
