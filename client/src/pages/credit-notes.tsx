import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ReceiptText, Plus, ThumbsUp, Ban, CheckCircle2, Clock, XCircle,
  Search, TrendingDown, FileText,
} from "lucide-react";

interface CreditNote {
  id: number; referenceId: string; creditType: string; clientName: string;
  clientId?: string; invoiceId?: number; disputeCaseId?: number; billingPeriod?: string;
  amountUsd: number; appliedAmountUsd?: number; reason: string; description?: string;
  status: string; approvedBy?: string; approvedAt?: string; appliedAt?: string;
  voidedAt?: string; createdBy?: string; createdAt: string;
}

const STATUS_CFG: Record<string, { color: string; label: string; icon: any }> = {
  DRAFT:    { color: 'text-slate-400 bg-slate-400/10 border-slate-400/30',    label: 'Draft',    icon: Clock        },
  APPROVED: { color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',    label: 'Approved', icon: ThumbsUp     },
  APPLIED:  { color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', label: 'Applied', icon: CheckCircle2 },
  VOID:     { color: 'text-red-400 bg-red-400/10 border-red-400/30',          label: 'Void',     icon: XCircle      },
};

const CREDIT_TYPES = [
  { value: 'partial_credit', label: 'Partial Credit' },
  { value: 'full_credit',    label: 'Full Credit'    },
  { value: 'adjustment',     label: 'Adjustment'     },
  { value: 'write_off',      label: 'Write-Off'      },
  { value: 'carry_forward',  label: 'Carry Forward'  },
];

const TYPE_COLORS: Record<string, string> = {
  partial_credit: 'text-sky-400',
  full_credit:    'text-blue-400',
  adjustment:     'text-purple-400',
  write_off:      'text-red-400',
  carry_forward:  'text-amber-400',
};

const createSchema = z.object({
  creditType:     z.string().min(1, 'Type required'),
  clientName:     z.string().min(1, 'Client required'),
  amountUsd:      z.string().min(1, 'Amount required'),
  reason:         z.string().min(1, 'Reason required'),
  description:    z.string().optional(),
  billingPeriod:  z.string().optional(),
  invoiceId:      z.string().optional(),
  disputeCaseId:  z.string().optional(),
});

const applySchema = z.object({
  appliedAmountUsd: z.string().min(1, 'Amount required'),
});

const voidSchema = z.object({ reason: z.string().min(1, 'Reason required') });

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.DRAFT;
  const Icon = cfg.icon;
  return <Badge variant="outline" className={`text-xs gap-1 ${cfg.color}`}><Icon className="h-3 w-3" />{cfg.label}</Badge>;
}

export default function CreditNotesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [applyNoteId, setApplyNoteId] = useState<number | null>(null);
  const [voidNoteId, setVoidNoteId] = useState<number | null>(null);

  const { data: notes = [], isLoading } = useQuery<CreditNote[]>({
    queryKey: ['/api/credit-notes'],
    queryFn:  () => apiRequest('GET', '/api/credit-notes').then(r => r.json()),
    refetchInterval: 30000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/api/credit-notes'] });

  const createForm = useForm({ resolver: zodResolver(createSchema),
    defaultValues: { creditType: 'partial_credit', clientName: '', amountUsd: '', reason: '', description: '', billingPeriod: '', invoiceId: '', disputeCaseId: '' },
  });
  const applyForm = useForm({ resolver: zodResolver(applySchema), defaultValues: { appliedAmountUsd: '' } });
  const voidForm  = useForm({ resolver: zodResolver(voidSchema),  defaultValues: { reason: '' } });

  const createMutation = useMutation({
    mutationFn: (d: any) => apiRequest('POST', '/api/credit-notes', {
      ...d,
      amountUsd:     parseFloat(d.amountUsd),
      invoiceId:     d.invoiceId ? parseInt(d.invoiceId) : undefined,
      disputeCaseId: d.disputeCaseId ? parseInt(d.disputeCaseId) : undefined,
      billingPeriod: d.billingPeriod || undefined,
    }).then(r => r.json()),
    onSuccess: (d) => { invalidate(); setCreateOpen(false); createForm.reset(); toast({ title: `Credit note ${d.referenceId} created` }); },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: string; body?: any }) =>
      apiRequest('PATCH', `/api/credit-notes/${id}/${action}`, body ?? {}).then(r => r.json()),
    onSuccess: (_, v) => {
      invalidate();
      toast({ title: { approve: 'Approved', apply: 'Applied to invoice', void: 'Voided' }[v.action] ?? 'Done' });
      setApplyNoteId(null); setVoidNoteId(null); applyForm.reset(); voidForm.reset();
    },
    onError: (e: any) => toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  });

  const filtered = notes.filter(n => {
    const matchStatus = filter === 'all' || n.status === filter.toUpperCase();
    const matchSearch = !search || n.clientName.toLowerCase().includes(search.toLowerCase()) || n.referenceId.includes(search);
    return matchStatus && matchSearch;
  });

  const totals = {
    draft:    notes.filter(n => n.status === 'DRAFT').reduce((s, n) => s + n.amountUsd, 0),
    approved: notes.filter(n => n.status === 'APPROVED').reduce((s, n) => s + n.amountUsd, 0),
    applied:  notes.filter(n => n.status === 'APPLIED').reduce((s, n) => s + (n.appliedAmountUsd ?? n.amountUsd), 0),
    written:  notes.filter(n => n.creditType === 'write_off' && n.status !== 'VOID').reduce((s, n) => s + n.amountUsd, 0),
  };

  const applyNote = notes.find(n => n.id === applyNoteId);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ReceiptText className="h-6 w-6 text-primary" />Credit Notes
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Credit adjustments, write-offs, and carry-forward management — DRAFT → APPROVED → APPLIED
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-new-credit-note"><Plus className="h-4 w-4 mr-1.5" />New Credit Note</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New Credit Note</DialogTitle></DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(d => createMutation.mutate(d))} className="space-y-3">
                <FormField control={createForm.control} name="creditType" render={({ field }) => (
                  <FormItem><FormLabel>Credit Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger data-testid="select-credit-type"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{CREDIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={createForm.control} name="clientName" render={({ field }) => (
                    <FormItem><FormLabel>Client Name</FormLabel><FormControl><Input data-testid="input-client-name" placeholder="Acme Telecom" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={createForm.control} name="amountUsd" render={({ field }) => (
                    <FormItem><FormLabel>Amount (USD)</FormLabel><FormControl><Input data-testid="input-amount" type="number" step="0.01" placeholder="0.00" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={createForm.control} name="billingPeriod" render={({ field }) => (
                    <FormItem><FormLabel>Billing Period</FormLabel><FormControl><Input type="month" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={createForm.control} name="invoiceId" render={({ field }) => (
                    <FormItem><FormLabel>Invoice ID (opt.)</FormLabel><FormControl><Input type="number" placeholder="e.g. 42" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={createForm.control} name="reason" render={({ field }) => (
                  <FormItem><FormLabel>Reason</FormLabel><FormControl><Input data-testid="input-reason" placeholder="Brief reason for credit…" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={createForm.control} name="description" render={({ field }) => (
                  <FormItem><FormLabel>Description (opt.)</FormLabel><FormControl><Textarea rows={2} placeholder="Detailed explanation…" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="flex gap-2 justify-end pt-1">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? 'Creating…' : 'Create'}</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Draft',       amount: totals.draft,    color: 'text-slate-400',   filter: 'draft'    },
          { label: 'Approved',    amount: totals.approved, color: 'text-amber-400',   filter: 'approved' },
          { label: 'Applied',     amount: totals.applied,  color: 'text-emerald-400', filter: 'applied'  },
          { label: 'Written Off', amount: totals.written,  color: 'text-red-400',     filter: 'all'      },
        ].map(s => (
          <Card key={s.label} className={`cursor-pointer transition-colors ${filter === s.filter && s.filter !== 'all' ? 'ring-2 ring-primary' : 'hover:bg-muted/30'}`}
            onClick={() => s.filter !== 'all' && setFilter(filter === s.filter ? 'all' : s.filter)} data-testid={`stat-${s.filter}`}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-xl font-bold tabular-nums ${s.color}`}>${s.amount.toFixed(2)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search notes…" className="pl-8" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
            </div>
            <div className="flex gap-1">
              {['all', 'draft', 'approved', 'applied', 'void'].map(s => (
                <Button key={s} size="sm" variant={filter === s ? 'default' : 'outline'} className="h-8 text-xs capitalize"
                  onClick={() => setFilter(s)}>{s}</Button>
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
                <TableHead>Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No credit notes. Click "New Credit Note" to create one.</TableCell></TableRow>
              )}
              {filtered.map(n => (
                <TableRow key={n.id} data-testid={`row-note-${n.id}`}>
                  <TableCell className="font-mono text-xs font-bold text-primary">{n.referenceId}</TableCell>
                  <TableCell className="font-medium text-sm">{n.clientName}</TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium ${TYPE_COLORS[n.creditType] ?? ''}`}>
                      {CREDIT_TYPES.find(t => t.value === n.creditType)?.label ?? n.creditType}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums font-medium text-sm">${n.amountUsd.toFixed(2)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{n.reason}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{n.invoiceId ? `#${n.invoiceId}` : '—'}</TableCell>
                  <TableCell><StatusBadge status={n.status} /></TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5">
                      {n.status === 'DRAFT' && (
                        <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                          data-testid={`button-approve-${n.id}`}
                          onClick={() => actionMutation.mutate({ id: n.id, action: 'approve' })}
                          disabled={actionMutation.isPending}>
                          <ThumbsUp className="h-3 w-3 mr-1" />Approve
                        </Button>
                      )}
                      {n.status === 'APPROVED' && (
                        <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          data-testid={`button-apply-${n.id}`}
                          onClick={() => { setApplyNoteId(n.id); applyForm.setValue('appliedAmountUsd', String(n.amountUsd)); }}>
                          <CheckCircle2 className="h-3 w-3 mr-1" />Apply
                        </Button>
                      )}
                      {['DRAFT', 'APPROVED'].includes(n.status) && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-500"
                          data-testid={`button-void-${n.id}`}
                          onClick={() => { setVoidNoteId(n.id); voidForm.reset(); }}>
                          <Ban className="h-3 w-3 mr-1" />Void
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

      {/* Apply dialog */}
      <Dialog open={applyNoteId != null} onOpenChange={() => setApplyNoteId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply Credit Note {applyNote?.referenceId}</DialogTitle></DialogHeader>
          <Form {...applyForm}>
            <form onSubmit={applyForm.handleSubmit(d => applyNoteId && actionMutation.mutate({ id: applyNoteId, action: 'apply', body: { appliedAmountUsd: parseFloat(d.appliedAmountUsd) } }))} className="space-y-4">
              <p className="text-sm text-muted-foreground">Max: <strong>${applyNote?.amountUsd.toFixed(2)}</strong></p>
              <FormField control={applyForm.control} name="appliedAmountUsd" render={({ field }) => (
                <FormItem><FormLabel>Applied Amount (USD)</FormLabel>
                  <FormControl><Input type="number" step="0.01" data-testid="input-applied-amount" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setApplyNoteId(null)}>Cancel</Button>
                <Button type="submit" disabled={actionMutation.isPending}>Apply Credit</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Void dialog */}
      <Dialog open={voidNoteId != null} onOpenChange={() => setVoidNoteId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void Credit Note</DialogTitle></DialogHeader>
          <Form {...voidForm}>
            <form onSubmit={voidForm.handleSubmit(d => voidNoteId && actionMutation.mutate({ id: voidNoteId, action: 'void', body: { reason: d.reason } }))} className="space-y-4">
              <FormField control={voidForm.control} name="reason" render={({ field }) => (
                <FormItem><FormLabel>Void Reason</FormLabel>
                  <FormControl><Input data-testid="input-void-reason" placeholder="Explain why this note is being voided…" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setVoidNoteId(null)}>Cancel</Button>
                <Button type="submit" variant="destructive">Void Note</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
