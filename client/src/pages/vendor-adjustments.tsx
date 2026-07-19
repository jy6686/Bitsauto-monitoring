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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
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
import { Calculator, Plus, Search, Loader2, RotateCcw, Send, Trash2, ArrowLeft } from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────
interface VendorAdjustment {
  id: number;
  adjustmentNumber: string;
  businessPartnerId: number;
  partnerName?: string;
  vendorBillId?: number;
  billNumber?: string;
  type: string;
  adjustmentDate: string;
  currency: string;
  amount: string;
  reason: string;
  description?: string;
  status: string;
  postedAt?: string;
  postedBy?: string;
  reversedAt?: string;
  reversedBy?: string;
  createdBy?: string;
  createdAt: string;
}

interface BusinessPartner { id: number; name: string; type: string; status: string; currency: string; }
interface VendorBill { id: number; billNumber: string; businessPartnerId: number; status: string; currency: string; }

// ── constants ─────────────────────────────────────────────────────────────────
const TYPE_CFG: Record<string, { label: string; color: string }> = {
  credit_note: { label: 'Credit Note', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  debit_note:  { label: 'Debit Note',  color: 'text-amber-400  bg-amber-400/10  border-amber-400/30'  },
  write_off:   { label: 'Write-Off',   color: 'text-red-400    bg-red-400/10    border-red-400/30'    },
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  draft:    { label: 'Draft',    color: 'text-slate-400   bg-slate-400/10   border-slate-400/30'   },
  posted:   { label: 'Posted',   color: 'text-blue-400    bg-blue-400/10    border-blue-400/30'    },
  reversed: { label: 'Reversed', color: 'text-red-400     bg-red-400/10     border-red-400/30'     },
};

function fmt(val: string | number | undefined, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parseFloat(String(val ?? 0)));
}

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CFG[type] ?? TYPE_CFG.credit_note;
  return <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>;
}
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft;
  return <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>;
}

// ── form schema ───────────────────────────────────────────────────────────────
const createSchema = z.object({
  businessPartnerId: z.string().min(1, 'Vendor required'),
  vendorBillId:      z.string().optional(),
  type:              z.enum(['credit_note', 'debit_note', 'write_off']),
  adjustmentDate:    z.string().min(1, 'Date required'),
  currency:          z.string().min(1),
  amount:            z.string().min(1, 'Amount required'),
  reason:            z.string().min(1, 'Reason required'),
  description:       z.string().optional(),
});

type CreateForm = z.infer<typeof createSchema>;

export default function VendorAdjustmentsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch]         = useState('');
  const [typeFilter, setType]       = useState('all');
  const [statusFilter, setStatus]   = useState('all');
  const [createOpen, setCreate]     = useState(false);
  const [selected, setSelected]     = useState<VendorAdjustment | null>(null);
  const [reverseId, setReverseId]   = useState<number | null>(null);
  const [deleteId, setDeleteId]     = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/api/vendor-adjustments'] });

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: adjustments = [], isLoading } = useQuery<VendorAdjustment[]>({
    queryKey: ['/api/vendor-adjustments'],
    queryFn:  () => apiRequest('GET', '/api/vendor-adjustments').then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: partners = [] } = useQuery<BusinessPartner[]>({
    queryKey: ['/api/business-partners'],
    queryFn:  () => apiRequest('GET', '/api/business-partners').then(r => r.json()),
  });

  const { data: bills = [] } = useQuery<VendorBill[]>({
    queryKey: ['/api/vendor-bills'],
    queryFn:  () => apiRequest('GET', '/api/vendor-bills').then(r => r.json()),
  });

  // ── create ────────────────────────────────────────────────────────────────
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      businessPartnerId: '', vendorBillId: '',
      type: 'credit_note', adjustmentDate: new Date().toISOString().slice(0, 10),
      currency: 'USD', amount: '', reason: '', description: '',
    },
  });

  const watchPartnerId = form.watch('businessPartnerId');
  const partnerBills   = bills.filter(b => String(b.businessPartnerId) === watchPartnerId);

  const createMutation = useMutation({
    mutationFn: (d: CreateForm) => apiRequest('POST', '/api/vendor-adjustments', {
      businessPartnerId: parseInt(d.businessPartnerId, 10),
      vendorBillId:      d.vendorBillId ? parseInt(d.vendorBillId, 10) : undefined,
      type:              d.type,
      adjustmentDate:    d.adjustmentDate,
      currency:          d.currency,
      amount:            parseFloat(d.amount),
      reason:            d.reason,
      description:       d.description || undefined,
    }).then(r => r.json()),
    onSuccess: () => {
      invalidate();
      setCreate(false);
      form.reset();
      toast({ title: 'Adjustment created as draft' });
    },
    onError: (e: any) => toast({ title: 'Create failed', description: e.message, variant: 'destructive' }),
  });

  // ── post ──────────────────────────────────────────────────────────────────
  const postMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/vendor-adjustments/${id}/post`).then(r => r.json()),
    onSuccess: (data) => {
      invalidate();
      setSelected(data);
      toast({ title: `Adjustment posted — ${data.adjustmentNumber}` });
    },
    onError: (e: any) => toast({ title: 'Post failed', description: e.message, variant: 'destructive' }),
  });

  // ── reverse ───────────────────────────────────────────────────────────────
  const reverseMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/vendor-adjustments/${id}/reverse`).then(r => r.json()),
    onSuccess: (data) => {
      invalidate();
      setSelected(data);
      setReverseId(null);
      toast({ title: 'Adjustment reversed' });
    },
    onError: (e: any) => toast({ title: 'Reverse failed', description: e.message, variant: 'destructive' }),
  });

  // ── delete (draft only) ───────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/vendor-adjustments/${id}`).then(r => r.json()),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
      if (selected) setSelected(null);
      toast({ title: 'Adjustment deleted' });
    },
    onError: (e: any) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  });

  // ── filtered view ─────────────────────────────────────────────────────────
  const visible = adjustments.filter(a => {
    if (typeFilter !== 'all'   && a.type   !== typeFilter)   return false;
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        a.adjustmentNumber.toLowerCase().includes(q) ||
        a.partnerName?.toLowerCase().includes(q) ||
        a.reason.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ── detail view ───────────────────────────────────────────────────────────
  if (selected) {
    const a = selected;
    return (
      <div className="p-6 space-y-5 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-mono">{a.adjustmentNumber}</h1>
              <TypeBadge type={a.type} />
              <StatusBadge status={a.status} />
            </div>
            <p className="text-sm text-muted-foreground">{a.partnerName} · {a.adjustmentDate}</p>
          </div>
          <div className="flex gap-2">
            {a.status === 'draft' && (
              <>
                <Button size="sm" className="gap-1.5" disabled={postMutation.isPending}
                  onClick={() => postMutation.mutate(a.id)}>
                  {postMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Post
                </Button>
                <Button size="sm" variant="ghost"
                  className="gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteId(a.id)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </>
            )}
            {a.status === 'posted' && (
              <Button size="sm" variant="outline"
                className="gap-1.5 text-amber-400 border-amber-400/40 hover:bg-amber-400/10"
                onClick={() => setReverseId(a.id)}>
                <RotateCcw className="h-3.5 w-3.5" /> Reverse
              </Button>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="pt-5 space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-muted-foreground">Type</p><p className="font-medium capitalize">{a.type.replace('_', ' ')}</p></div>
              <div><p className="text-xs text-muted-foreground">Amount</p><p className="font-semibold text-base">{fmt(a.amount, a.currency)}</p></div>
              <div><p className="text-xs text-muted-foreground">Date</p><p>{a.adjustmentDate}</p></div>
              <div><p className="text-xs text-muted-foreground">Currency</p><p>{a.currency}</p></div>
              {a.billNumber && (
                <div><p className="text-xs text-muted-foreground">Linked Bill</p><p className="font-mono">{a.billNumber}</p></div>
              )}
              {a.postedBy && (
                <div><p className="text-xs text-muted-foreground">Posted By</p><p>{a.postedBy}</p></div>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Reason</p>
              <p>{a.reason}</p>
            </div>
            {a.description && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Description</p>
                <p className="whitespace-pre-wrap">{a.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reverse confirm */}
        <AlertDialog open={reverseId !== null} onOpenChange={o => !o && setReverseId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reverse {a.adjustmentNumber}?</AlertDialogTitle>
              <AlertDialogDescription>This will mark the adjustment as reversed. It cannot be re-posted.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => reverseId !== null && reverseMutation.mutate(reverseId)}>
                {reverseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reverse'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete confirm */}
        <AlertDialog open={deleteId !== null} onOpenChange={o => !o && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete draft adjustment?</AlertDialogTitle>
              <AlertDialogDescription>This draft will be permanently removed.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}>
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ── list view ─────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Calculator className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Adjustments</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Credit notes, debit notes and write-offs raised against vendors.
          </p>
        </div>
        <Button className="ml-auto gap-2" onClick={() => setCreate(true)}>
          <Plus className="h-4 w-4" /> New Adjustment
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by number, vendor or reason…" className="pl-9"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={typeFilter} onValueChange={setType}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(TYPE_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-32"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{visible.length} of {adjustments.length}</span>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <Calculator className="h-8 w-8 opacity-30" />
              <p className="text-sm">{adjustments.length === 0
                ? 'No adjustments yet — create a credit or debit note against a vendor.'
                : 'No adjustments match the current filter.'}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Linked Bill</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(a => (
                  <TableRow key={a.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(a)}>
                    <TableCell className="font-mono text-sm font-medium">{a.adjustmentNumber}</TableCell>
                    <TableCell className="text-sm">{a.partnerName ?? '—'}</TableCell>
                    <TableCell><TypeBadge type={a.type} /></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{a.billNumber ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.adjustmentDate}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-40 truncate">{a.reason}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(a.amount, a.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreate(o); if (!o) form.reset(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Adjustment</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => createMutation.mutate(d))} className="space-y-4">

              <FormField control={form.control} name="businessPartnerId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Vendor <span className="text-destructive">*</span></FormLabel>
                  <Select value={field.value} onValueChange={v => {
                    field.onChange(v);
                    form.setValue('vendorBillId', '');
                    const p = partners.find(x => String(x.id) === v);
                    if (p) form.setValue('currency', p.currency);
                  }}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select vendor…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {partners.filter(p => p.status === 'active').map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="credit_note">Credit Note</SelectItem>
                        <SelectItem value="debit_note">Debit Note</SelectItem>
                        <SelectItem value="write_off">Write-Off</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="adjustmentDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="number" min="0" step="0.01" placeholder="0.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="currency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {['USD','EUR','GBP','AED','SAR'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="vendorBillId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Linked Bill (optional)</FormLabel>
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select a bill to link…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="">No linked bill</SelectItem>
                      {partnerBills.map(b => (
                        <SelectItem key={b.id} value={String(b.id)}>{b.billNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="reason" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="Short reason for this adjustment" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea placeholder="Additional detail…" rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setCreate(false); form.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending} className="gap-2">
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Draft
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
