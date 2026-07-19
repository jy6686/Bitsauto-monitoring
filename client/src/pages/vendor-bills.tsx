import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
import {
  FileText, Plus, Search, Loader2, CheckCircle, XCircle,
  Send, Trash2, Ban, ChevronRight, ArrowLeft, Eye,
} from "lucide-react";
import { format } from "date-fns";

// ── types ─────────────────────────────────────────────────────────────────────
interface BillLine {
  id: number;
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  amount: string;
  taxAmount: string;
  glCode?: string;
}

interface VendorBill {
  id: number;
  billNumber: string;
  businessPartnerId: number;
  partnerName?: string;
  partnerType?: string;
  vendorReference?: string;
  billDate: string;
  dueDate: string;
  currency: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  outstanding: string;
  status: string;
  approvalStatus: string;
  notes?: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  partner?: { id: number; name: string; type: string; currency: string; paymentTermsDays: number };
  lines?: BillLine[];
}

interface BusinessPartner {
  id: number;
  name: string;
  type: string;
  status: string;
  currency: string;
  paymentTermsDays: number;
}

// ── constants ─────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; color: string }> = {
  draft:          { label: 'Draft',          color: 'text-slate-400   bg-slate-400/10   border-slate-400/30'   },
  submitted:      { label: 'Submitted',      color: 'text-blue-400    bg-blue-400/10    border-blue-400/30'    },
  under_review:   { label: 'Under Review',   color: 'text-amber-400   bg-amber-400/10   border-amber-400/30'   },
  approved:       { label: 'Approved',       color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  partially_paid: { label: 'Part. Paid',     color: 'text-sky-400     bg-sky-400/10     border-sky-400/30'     },
  paid:           { label: 'Paid',           color: 'text-green-400   bg-green-400/10   border-green-400/30'   },
  disputed:       { label: 'Disputed',       color: 'text-orange-400  bg-orange-400/10  border-orange-400/30'  },
  void:           { label: 'Void',           color: 'text-red-400     bg-red-400/10     border-red-400/30'     },
};

function fmt(val: string | number | undefined, currency = 'USD') {
  const n = parseFloat(String(val ?? 0));
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft;
  return <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>;
}

// ── create form schema ────────────────────────────────────────────────────────
const lineSchema = z.object({
  description: z.string().min(1, 'Description required'),
  quantity:    z.string().min(1),
  unitPrice:   z.string().min(1),
  taxRate:     z.string(),
  glCode:      z.string().optional(),
});

const createSchema = z.object({
  businessPartnerId: z.string().min(1, 'Vendor required'),
  vendorReference:   z.string().optional(),
  billDate:          z.string().min(1, 'Bill date required'),
  dueDate:           z.string().min(1, 'Due date required'),
  currency:          z.string().min(1),
  notes:             z.string().optional(),
  lines:             z.array(lineSchema).min(1, 'At least one line item required'),
});

type CreateForm = z.infer<typeof createSchema>;

const rejectSchema = z.object({ reason: z.string().min(1, 'Reason required') });

// ── line totals ───────────────────────────────────────────────────────────────
function lineAmount(qty: string, price: string) {
  return parseFloat(qty || '0') * parseFloat(price || '0');
}
function lineTax(qty: string, price: string, rate: string) {
  return lineAmount(qty, price) * parseFloat(rate || '0');
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function VendorBillsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('all');
  const [createOpen, setCreate]     = useState(false);
  const [selectedBill, setSelected] = useState<VendorBill | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [voidId, setVoidId]         = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/api/vendor-bills'] });

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: bills = [], isLoading } = useQuery<VendorBill[]>({
    queryKey: ['/api/vendor-bills'],
    queryFn:  () => apiRequest('GET', '/api/vendor-bills').then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: partners = [] } = useQuery<BusinessPartner[]>({
    queryKey: ['/api/business-partners'],
    queryFn:  () => apiRequest('GET', '/api/business-partners').then(r => r.json()),
  });

  // Reload full bill detail when selected
  const { data: billDetail, isLoading: detailLoading } = useQuery<VendorBill>({
    queryKey: ['/api/vendor-bills', selectedBill?.id],
    queryFn:  () => apiRequest('GET', `/api/vendor-bills/${selectedBill!.id}`).then(r => r.json()),
    enabled:  selectedBill !== null,
  });

  // ── create form ───────────────────────────────────────────────────────────
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      businessPartnerId: '',
      vendorReference:   '',
      billDate:          new Date().toISOString().slice(0, 10),
      dueDate:           '',
      currency:          'USD',
      notes:             '',
      lines: [{ description: '', quantity: '1', unitPrice: '0', taxRate: '0', glCode: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });

  // Auto-populate currency + due date when partner selected
  const watchPartnerId = form.watch('businessPartnerId');
  const watchBillDate  = form.watch('billDate');
  const watchLines     = form.watch('lines');

  const selectedPartner = partners.find(p => String(p.id) === watchPartnerId);

  // Compute live totals
  const liveSubtotal  = watchLines.reduce((s, l) => s + lineAmount(l.quantity, l.unitPrice), 0);
  const liveTax       = watchLines.reduce((s, l) => s + lineTax(l.quantity, l.unitPrice, l.taxRate), 0);
  const liveTotal     = liveSubtotal + liveTax;

  const createMutation = useMutation({
    mutationFn: (d: CreateForm) => apiRequest('POST', '/api/vendor-bills', {
      ...d,
      businessPartnerId: parseInt(d.businessPartnerId, 10),
      vendorReference:   d.vendorReference || undefined,
      notes:             d.notes           || undefined,
      lines: d.lines.map(l => ({
        description: l.description,
        quantity:    parseFloat(l.quantity),
        unitPrice:   parseFloat(l.unitPrice),
        taxRate:     parseFloat(l.taxRate) / 100,  // UI: %, API: 0–1
        glCode:      l.glCode || undefined,
      })),
    }).then(r => r.json()),
    onSuccess: () => {
      invalidate();
      setCreate(false);
      form.reset();
      toast({ title: 'Draft bill created' });
    },
    onError: (e: any) => toast({ title: 'Create failed', description: e.message, variant: 'destructive' }),
  });

  // ── submit ────────────────────────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/vendor-bills/${id}/submit`).then(r => r.json()),
    onSuccess: (data) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['/api/vendor-bills', data.id] });
      setSelected(data);
      toast({ title: `Bill submitted — ${data.billNumber}` });
    },
    onError: (e: any) => toast({ title: 'Submit failed', description: e.message, variant: 'destructive' }),
  });

  // ── approve ───────────────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/vendor-bills/${id}/approve`).then(r => r.json()),
    onSuccess: (data) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['/api/vendor-bills', data.id] });
      setSelected(data);
      toast({ title: 'Bill approved' });
    },
    onError: (e: any) => toast({ title: 'Approve failed', description: e.message, variant: 'destructive' }),
  });

  // ── reject ────────────────────────────────────────────────────────────────
  const rejectForm = useForm({ resolver: zodResolver(rejectSchema), defaultValues: { reason: '' } });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiRequest('POST', `/api/vendor-bills/${id}/reject`, { reason }).then(r => r.json()),
    onSuccess: (data) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['/api/vendor-bills', data.id] });
      setSelected(data);
      setRejectOpen(false);
      rejectForm.reset();
      toast({ title: 'Bill returned to draft', description: 'Rejection note added' });
    },
    onError: (e: any) => toast({ title: 'Reject failed', description: e.message, variant: 'destructive' }),
  });

  // ── void ──────────────────────────────────────────────────────────────────
  const voidMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/vendor-bills/${id}/void`).then(r => r.json()),
    onSuccess: (data) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['/api/vendor-bills', data.id] });
      setSelected(data);
      setVoidId(null);
      toast({ title: 'Bill voided' });
    },
    onError: (e: any) => toast({ title: 'Void failed', description: e.message, variant: 'destructive' }),
  });

  // ── filtered view ─────────────────────────────────────────────────────────
  const visible = bills.filter(b => {
    if (statusFilter !== 'all' && b.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        b.billNumber.toLowerCase().includes(q) ||
        b.partnerName?.toLowerCase().includes(q) ||
        b.vendorReference?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ── detail view ───────────────────────────────────────────────────────────
  if (selectedBill) {
    const bill = billDetail ?? selectedBill;
    const canSubmit  = bill.status === 'draft';
    const canApprove = ['submitted', 'under_review'].includes(bill.status);
    const canReject  = ['submitted', 'under_review'].includes(bill.status);
    const canVoid    = !['paid', 'void'].includes(bill.status);

    return (
      <div className="p-6 space-y-5 max-w-4xl mx-auto">
        {/* Back + header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelected(null)} className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight truncate">{bill.billNumber}</h1>
              <StatusBadge status={bill.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {bill.partnerName ?? bill.partner?.name} · Due {bill.dueDate}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canSubmit && (
              <Button size="sm" className="gap-1.5" disabled={submitMutation.isPending}
                onClick={() => submitMutation.mutate(bill.id)}>
                {submitMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Submit
              </Button>
            )}
            {canApprove && (
              <Button size="sm" variant="outline"
                className="gap-1.5 text-emerald-400 border-emerald-400/40 hover:bg-emerald-400/10"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate(bill.id)}>
                {approveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                Approve
              </Button>
            )}
            {canReject && (
              <Button size="sm" variant="outline"
                className="gap-1.5 text-amber-400 border-amber-400/40 hover:bg-amber-400/10"
                onClick={() => setRejectOpen(true)}>
                <XCircle className="h-3.5 w-3.5" /> Reject
              </Button>
            )}
            {canVoid && (
              <Button size="sm" variant="ghost"
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => setVoidId(bill.id)}>
                <Ban className="h-3.5 w-3.5" /> Void
              </Button>
            )}
          </div>
        </div>

        {detailLoading ? (
          <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> <span className="text-sm">Loading…</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Left: details */}
            <div className="md:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Bill Details</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Bill Date</p><p className="font-medium">{bill.billDate}</p></div>
                  <div><p className="text-xs text-muted-foreground">Due Date</p><p className="font-medium">{bill.dueDate}</p></div>
                  <div><p className="text-xs text-muted-foreground">Vendor Ref</p><p className="font-medium">{bill.vendorReference || '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">Currency</p><p className="font-medium">{bill.currency}</p></div>
                  <div><p className="text-xs text-muted-foreground">Created By</p><p className="font-medium">{bill.createdBy || '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">Approved By</p><p className="font-medium">{bill.approvedBy || '—'}</p></div>
                </CardContent>
              </Card>

              {/* Line items */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Line Items</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Tax %</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(bill.lines ?? []).map(l => (
                        <TableRow key={l.id}>
                          <TableCell className="text-muted-foreground text-xs">{l.lineNumber}</TableCell>
                          <TableCell>
                            <p>{l.description}</p>
                            {l.glCode && <p className="text-xs text-muted-foreground">GL: {l.glCode}</p>}
                          </TableCell>
                          <TableCell className="text-right text-sm">{l.quantity}</TableCell>
                          <TableCell className="text-right text-sm">{fmt(l.unitPrice, bill.currency)}</TableCell>
                          <TableCell className="text-right text-sm">
                            {(parseFloat(l.taxRate) * 100).toFixed(0)}%
                          </TableCell>
                          <TableCell className="text-right font-medium">{fmt(l.amount, bill.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {bill.notes && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{bill.notes}</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right: totals */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Totals</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{fmt(bill.subtotal, bill.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span>{fmt(bill.taxAmount, bill.currency)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold text-base">
                    <span>Total</span>
                    <span>{fmt(bill.total, bill.currency)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Outstanding</span>
                    <span className="text-amber-400 font-medium">{fmt(bill.outstanding, bill.currency)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Reject dialog */}
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Reject Bill</DialogTitle></DialogHeader>
            <Form {...rejectForm}>
              <form onSubmit={rejectForm.handleSubmit(d => rejectMutation.mutate({ id: bill.id, reason: d.reason }))}
                className="space-y-4">
                <FormField control={rejectForm.control} name="reason" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rejection Reason <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Textarea placeholder="Describe the issue…" rows={3} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
                  <Button type="submit" variant="destructive" disabled={rejectMutation.isPending} className="gap-2">
                    {rejectMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Reject
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Void confirm */}
        <AlertDialog open={voidId !== null} onOpenChange={o => !o && setVoidId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Void this bill?</AlertDialogTitle>
              <AlertDialogDescription>
                {bill.billNumber} will be marked void and can no longer receive payments. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => voidId !== null && voidMutation.mutate(voidId)}>
                {voidMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Void Bill'}
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

      {/* Header */}
      <div className="flex items-center gap-3">
        <FileText className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Bills</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            AP invoices received from vendors — draft, submit, approve and track payment.
          </p>
        </div>
        <Button className="ml-auto gap-2" onClick={() => setCreate(true)}>
          <Plus className="h-4 w-4" /> New Bill
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search bill number, vendor or ref…" className="pl-9"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_CFG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{visible.length} of {bills.length}</span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <FileText className="h-8 w-8 opacity-30" />
              <p className="text-sm">
                {bills.length === 0
                  ? 'No bills yet — click New Bill to create your first AP invoice.'
                  : 'No bills match the current filter.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Vendor Ref</TableHead>
                  <TableHead>Bill Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(b => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelected(b)}
                  >
                    <TableCell className="font-mono text-sm font-medium">{b.billNumber}</TableCell>
                    <TableCell className="text-sm">{b.partnerName ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.vendorReference ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.billDate}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.dueDate}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-right text-sm font-medium">{fmt(b.total, b.currency)}</TableCell>
                    <TableCell className="text-right text-sm text-amber-400">{fmt(b.outstanding, b.currency)}</TableCell>
                    <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreate(o); if (!o) form.reset(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Vendor Bill</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => createMutation.mutate(d))} className="space-y-5">

              {/* Header fields */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="businessPartnerId" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Vendor <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value} onValueChange={(v) => {
                      field.onChange(v);
                      const p = partners.find(x => String(x.id) === v);
                      if (p) {
                        form.setValue('currency', p.currency);
                        if (watchBillDate) {
                          const d = new Date(watchBillDate);
                          d.setDate(d.getDate() + p.paymentTermsDays);
                          form.setValue('dueDate', d.toISOString().slice(0, 10));
                        }
                      }
                    }}>
                      <FormControl><SelectTrigger>
                        <SelectValue placeholder="Select a business partner…" />
                      </SelectTrigger></FormControl>
                      <SelectContent>
                        {partners.filter(p => p.status === 'active').map(p => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="billDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bill Date <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="date" {...field} onChange={e => {
                      field.onChange(e);
                      if (selectedPartner) {
                        const d = new Date(e.target.value);
                        d.setDate(d.getDate() + selectedPartner.paymentTermsDays);
                        form.setValue('dueDate', d.toISOString().slice(0, 10));
                      }
                    }} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="dueDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="vendorReference" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor Reference</FormLabel>
                    <FormControl><Input placeholder="Vendor's invoice number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="currency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {['USD','EUR','GBP','AED','SAR'].map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Line items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Line Items <span className="text-destructive">*</span></p>
                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs"
                    onClick={() => append({ description: '', quantity: '1', unitPrice: '0', taxRate: '0', glCode: '' })}>
                    <Plus className="h-3 w-3" /> Add Line
                  </Button>
                </div>

                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-52">Description</TableHead>
                        <TableHead className="w-16 text-right">Qty</TableHead>
                        <TableHead className="w-24 text-right">Unit Price</TableHead>
                        <TableHead className="w-16 text-right">Tax %</TableHead>
                        <TableHead className="w-20 text-right">Amount</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fields.map((field, i) => {
                        const l = watchLines[i] ?? field;
                        const amt = lineAmount(l.quantity, l.unitPrice);
                        const tax = lineTax(l.quantity, l.unitPrice, l.taxRate);
                        return (
                          <TableRow key={field.id}>
                            <TableCell className="py-1 px-2">
                              <FormField control={form.control} name={`lines.${i}.description`} render={({ field }) => (
                                <Input className="h-7 text-xs" placeholder="Description" {...field} />
                              )} />
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              <FormField control={form.control} name={`lines.${i}.quantity`} render={({ field }) => (
                                <Input className="h-7 text-xs text-right" type="number" min="0" step="0.01" {...field} />
                              )} />
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              <FormField control={form.control} name={`lines.${i}.unitPrice`} render={({ field }) => (
                                <Input className="h-7 text-xs text-right" type="number" min="0" step="0.0001" {...field} />
                              )} />
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              <FormField control={form.control} name={`lines.${i}.taxRate`} render={({ field }) => (
                                <Input className="h-7 text-xs text-right" type="number" min="0" max="100" step="0.1" {...field} />
                              )} />
                            </TableCell>
                            <TableCell className="py-1 px-2 text-right text-xs">
                              <span className="font-medium">{fmt(amt + tax)}</span>
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              {fields.length > 1 && (
                                <Button type="button" variant="ghost" size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={() => remove(i)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {form.formState.errors.lines?.root && (
                  <p className="text-xs text-destructive">{form.formState.errors.lines.root.message}</p>
                )}

                {/* Live totals */}
                <div className="flex justify-end">
                  <div className="text-sm space-y-1 min-w-48">
                    <div className="flex justify-between gap-8 text-muted-foreground">
                      <span>Subtotal</span><span>{fmt(liveSubtotal)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax</span><span>{fmt(liveTax)}</span>
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between font-semibold">
                      <span>Total</span><span>{fmt(liveTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea placeholder="Internal notes…" rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setCreate(false); form.reset(); }}>
                  Cancel
                </Button>
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
