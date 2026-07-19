import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  CreditCard, Plus, Search, Loader2, RotateCcw, ArrowLeft,
  CheckCircle, Trash2,
} from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────
interface VendorPayment {
  id: number;
  paymentNumber: string;
  businessPartnerId: number;
  partnerName?: string;
  paymentDate: string;
  currency: string;
  amount: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  status: string;
  reversedAt?: string;
  reversedBy?: string;
  createdBy?: string;
  createdAt: string;
  partner?: { id: number; name: string };
  allocations?: Array<{
    id: number; vendorBillId: number; allocatedAmount: string;
    billNumber?: string; status?: string; outstanding?: string; total?: string;
  }>;
}

interface VendorBill {
  id: number;
  billNumber: string;
  businessPartnerId: number;
  partnerName?: string;
  currency: string;
  total: string;
  outstanding: string;
  status: string;
}

interface BusinessPartner {
  id: number; name: string; type: string; status: string; currency: string;
}

// ── constants ─────────────────────────────────────────────────────────────────
const METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer', cheque: 'Cheque', card: 'Card',
  direct_debit: 'Direct Debit', cash: 'Cash', other: 'Other',
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  posted:   { label: 'Posted',   color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  reversed: { label: 'Reversed', color: 'text-red-400     bg-red-400/10     border-red-400/30'     },
};

function fmt(val: string | number | undefined, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parseFloat(String(val ?? 0)));
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.posted;
  return <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>;
}

// ── create form schema ────────────────────────────────────────────────────────
const allocationSchema = z.object({
  vendorBillId:    z.string().min(1, 'Bill required'),
  allocatedAmount: z.string().min(1, 'Amount required'),
});

const createSchema = z.object({
  businessPartnerId: z.string().min(1, 'Vendor required'),
  paymentDate:       z.string().min(1, 'Date required'),
  currency:          z.string().min(1),
  amount:            z.string().min(1, 'Amount required'),
  paymentMethod:     z.string().min(1),
  reference:         z.string().optional(),
  notes:             z.string().optional(),
  allocations:       z.array(allocationSchema).min(1, 'At least one bill allocation required'),
});

type CreateForm = z.infer<typeof createSchema>;

export default function VendorPaymentsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch]         = useState('');
  const [createOpen, setCreate]     = useState(false);
  const [selected, setSelected]     = useState<VendorPayment | null>(null);
  const [reverseId, setReverseId]   = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/api/vendor-payments'] });

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: payments = [], isLoading } = useQuery<VendorPayment[]>({
    queryKey: ['/api/vendor-payments'],
    queryFn:  () => apiRequest('GET', '/api/vendor-payments').then(r => r.json()),
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

  const { data: paymentDetail } = useQuery<VendorPayment>({
    queryKey: ['/api/vendor-payments', selected?.id],
    queryFn:  () => apiRequest('GET', `/api/vendor-payments/${selected!.id}`).then(r => r.json()),
    enabled:  selected !== null,
  });

  // ── create ────────────────────────────────────────────────────────────────
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      businessPartnerId: '', paymentDate: new Date().toISOString().slice(0, 10),
      currency: 'USD', amount: '', paymentMethod: 'bank_transfer',
      reference: '', notes: '',
      allocations: [{ vendorBillId: '', allocatedAmount: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'allocations' });
  const watchPartnerId  = form.watch('businessPartnerId');
  const watchAllocations = form.watch('allocations');

  // Bills available for this partner that can receive payment
  const eligibleBills = bills.filter(b =>
    String(b.businessPartnerId) === watchPartnerId &&
    ['approved', 'partially_paid'].includes(b.status),
  );

  // Live total of allocations
  const allocTotal = watchAllocations.reduce((s, a) => s + parseFloat(a.allocatedAmount || '0'), 0);

  const createMutation = useMutation({
    mutationFn: (d: CreateForm) => apiRequest('POST', '/api/vendor-payments', {
      businessPartnerId: parseInt(d.businessPartnerId, 10),
      paymentDate:       d.paymentDate,
      currency:          d.currency,
      amount:            parseFloat(d.amount),
      paymentMethod:     d.paymentMethod,
      reference:         d.reference || undefined,
      notes:             d.notes || undefined,
      allocations: d.allocations.map(a => ({
        vendorBillId:    parseInt(a.vendorBillId, 10),
        allocatedAmount: parseFloat(a.allocatedAmount),
      })),
    }).then(r => r.json()),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['/api/vendor-bills'] });
      setCreate(false);
      form.reset();
      toast({ title: 'Payment recorded' });
    },
    onError: (e: any) => toast({ title: 'Payment failed', description: e.message, variant: 'destructive' }),
  });

  // ── reverse ───────────────────────────────────────────────────────────────
  const reverseMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/vendor-payments/${id}/reverse`).then(r => r.json()),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['/api/vendor-bills'] });
      if (selected) qc.invalidateQueries({ queryKey: ['/api/vendor-payments', selected.id] });
      setReverseId(null);
      toast({ title: 'Payment reversed — bill balances restored' });
    },
    onError: (e: any) => toast({ title: 'Reverse failed', description: e.message, variant: 'destructive' }),
  });

  // ── filtered view ─────────────────────────────────────────────────────────
  const visible = payments.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.paymentNumber.toLowerCase().includes(q) ||
      p.partnerName?.toLowerCase().includes(q) ||
      p.reference?.toLowerCase().includes(q)
    );
  });

  // ── detail view ───────────────────────────────────────────────────────────
  if (selected) {
    const pay = paymentDetail ?? selected;
    return (
      <div className="p-6 space-y-5 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight font-mono">{pay.paymentNumber}</h1>
              <StatusBadge status={pay.status} />
            </div>
            <p className="text-sm text-muted-foreground">{pay.partnerName ?? pay.partner?.name} · {pay.paymentDate}</p>
          </div>
          {pay.status === 'posted' && (
            <Button size="sm" variant="outline"
              className="gap-1.5 text-amber-400 border-amber-400/40 hover:bg-amber-400/10"
              onClick={() => setReverseId(pay.id)}>
              <RotateCcw className="h-3.5 w-3.5" /> Reverse
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium">Payment Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Method</span>
                <span>{METHOD_LABELS[pay.paymentMethod] ?? pay.paymentMethod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-mono text-xs">{pay.reference || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Currency</span>
                <span>{pay.currency}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold text-base">
                <span>Total Paid</span>
                <span className="text-emerald-400">{fmt(pay.amount, pay.currency)}</span>
              </div>
            </CardContent>
          </Card>

          {pay.notes && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{pay.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Bill Allocations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill Number</TableHead>
                  <TableHead>Bill Status</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Outstanding After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pay.allocations ?? []).map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.billNumber ?? `Bill #${a.vendorBillId}`}</TableCell>
                    <TableCell>
                      {a.status && (
                        <Badge variant="outline" className="text-xs">
                          {a.status.replace('_', ' ')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-emerald-400 font-medium">
                      {fmt(a.allocatedAmount, pay.currency)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {a.outstanding !== undefined ? fmt(a.outstanding, pay.currency) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <AlertDialog open={reverseId !== null} onOpenChange={o => !o && setReverseId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reverse payment {pay.paymentNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                All bill outstanding balances will be restored. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => reverseId !== null && reverseMutation.mutate(reverseId)}>
                {reverseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reverse Payment'}
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
        <CreditCard className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Payments</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Record outbound payments and allocate them against approved bills.
          </p>
        </div>
        <Button className="ml-auto gap-2" onClick={() => setCreate(true)}>
          <Plus className="h-4 w-4" /> Record Payment
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by number, vendor or ref…" className="pl-9"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">{visible.length} of {payments.length}</span>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> <span className="text-sm">Loading…</span>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <CreditCard className="h-8 w-8 opacity-30" />
              <p className="text-sm">{payments.length === 0
                ? 'No payments recorded yet. Approve a bill first, then record a payment here.'
                : 'No payments match the search.'}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment No.</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(p => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelected(p)}>
                    <TableCell className="font-mono text-sm font-medium">{p.paymentNumber}</TableCell>
                    <TableCell className="text-sm">{p.partnerName ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.paymentDate}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod}</TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">{p.reference ?? '—'}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell className="text-right font-medium text-emerald-400">{fmt(p.amount, p.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreate(o); if (!o) form.reset(); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => createMutation.mutate(d))} className="space-y-4">

              <FormField control={form.control} name="businessPartnerId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Vendor <span className="text-destructive">*</span></FormLabel>
                  <Select value={field.value} onValueChange={v => {
                    field.onChange(v);
                    const p = partners.find(x => String(x.id) === v);
                    if (p) form.setValue('currency', p.currency);
                    // Reset allocations when vendor changes
                    form.setValue('allocations', [{ vendorBillId: '', allocatedAmount: '' }]);
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
                <FormField control={form.control} name="paymentDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Date <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
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

                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Amount <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="number" min="0" step="0.01" placeholder="0.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Method</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(METHOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="reference" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank Reference / Cheque No.</FormLabel>
                  <FormControl><Input placeholder="TXN-20260001" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Bill allocations */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Bill Allocations <span className="text-destructive">*</span></p>
                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs"
                    onClick={() => append({ vendorBillId: '', allocatedAmount: '' })}>
                    <Plus className="h-3 w-3" /> Add Bill
                  </Button>
                </div>

                {eligibleBills.length === 0 && watchPartnerId && (
                  <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded p-2">
                    No approved bills found for this vendor. Approve a bill first before recording payment.
                  </p>
                )}

                <div className="space-y-2">
                  {fields.map((field, i) => (
                    <div key={field.id} className="flex items-end gap-2">
                      <FormField control={form.control} name={`allocations.${i}.vendorBillId`} render={({ field }) => (
                        <FormItem className="flex-1">
                          {i === 0 && <FormLabel className="text-xs">Bill</FormLabel>}
                          <Select value={field.value} onValueChange={v => {
                            field.onChange(v);
                            // Auto-fill outstanding amount
                            const b = eligibleBills.find(x => String(x.id) === v);
                            if (b) form.setValue(`allocations.${i}.allocatedAmount`, parseFloat(b.outstanding).toFixed(2));
                          }}>
                            <FormControl><SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder="Select bill…" />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                              {eligibleBills.map(b => (
                                <SelectItem key={b.id} value={String(b.id)}>
                                  {b.billNumber} — {fmt(b.outstanding, b.currency)} outstanding
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`allocations.${i}.allocatedAmount`} render={({ field }) => (
                        <FormItem className="w-32">
                          {i === 0 && <FormLabel className="text-xs">Amount</FormLabel>}
                          <FormControl><Input className="h-8 text-sm text-right" type="number" min="0" step="0.01" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      {fields.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 mb-0.5 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(i)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end text-sm text-muted-foreground gap-2 pt-1">
                  <span>Allocations total:</span>
                  <span className={Math.abs(allocTotal - parseFloat(form.watch('amount') || '0')) > 0.01
                    ? 'text-amber-400 font-medium' : 'text-emerald-400 font-medium'}>
                    {fmt(allocTotal)}
                  </span>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setCreate(false); form.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending} className="gap-2">
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Record Payment
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
