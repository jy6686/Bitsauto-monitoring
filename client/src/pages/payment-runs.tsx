import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  SendHorizontal, Plus, Loader2, ArrowLeft, CheckCircle,
  ClipboardList, Play, XCircle, Trash2, ChevronRight,
} from "lucide-react";

// ── types ──────────────────────────────────────────────────────────────────────
interface PaymentRunSummary {
  id:                number;
  runNumber:         string;
  name:              string;
  treasuryAccountId: number;
  accountName:       string | null;
  currency:          string;
  totalAmount:       string;
  itemCount:         number;
  status:            string;
  scheduledDate:     string | null;
  executedAt:        string | null;
  createdBy:         string;
  createdAt:         string;
}

interface PaymentRunDetail extends PaymentRunSummary {
  accountType:       string | null;
  executionMode:     string;
  executedBy:        string | null;
  externalReference: string | null;
  executionNotes:    string | null;
  notes:             string | null;
  reviewedBy:        string | null;
  reviewedAt:        string | null;
  approvedBy:        string | null;
  approvedAt:        string | null;
  updatedAt:         string;
  items:             RunItem[];
}

interface RunItem {
  id:               number;
  vendorBillId:     number;
  billNumber:       string;
  billStatus:       string;
  billTotal:        string;
  billOutstanding:  string;
  billDueDate:      string | null;
  businessPartnerId: number;
  partnerName:      string | null;
  amount:           string;
  currency:         string;
  itemStatus:       string;
  vendorPaymentId:  number | null;
  notes:            string | null;
}

interface EligibleBill {
  id:               number;
  billNumber:       string;
  businessPartnerId: number;
  partnerName:      string | null;
  status:           string;
  currency:         string;
  total:            string;
  outstanding:      string;
  dueDate:          string | null;
}

interface TreasuryAccount {
  id:       number;
  name:     string;
  type:     string;
  currency: string;
  status:   string;
  currentBalance: string;
}

// ── form schema ────────────────────────────────────────────────────────────────
const createRunSchema = z.object({
  name:               z.string().min(1, "Run name is required"),
  treasuryAccountId:  z.string().min(1, "Treasury account is required"),
  scheduledDate:      z.string().optional(),
  notes:              z.string().optional(),
  items:              z.array(z.object({
    vendorBillId: z.string(),
    amount:       z.string(),
    currency:     z.string(),
  })).min(1, "At least one bill is required"),
});
type CreateRunForm = z.infer<typeof createRunSchema>;

// ── helpers ────────────────────────────────────────────────────────────────────
function fmt(n: string | number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n));
  } catch {
    return `${Number(n).toLocaleString()} ${currency}`;
  }
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  draft:     { label: 'Draft',     color: 'text-slate-400   bg-slate-400/10   border-slate-400/30' },
  reviewed:  { label: 'Reviewed',  color: 'text-blue-400    bg-blue-400/10    border-blue-400/30' },
  approved:  { label: 'Approved',  color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  executed:  { label: 'Executed',  color: 'text-violet-400  bg-violet-400/10  border-violet-400/30' },
  completed: { label: 'Completed', color: 'text-green-400   bg-green-400/10   border-green-400/30' },
  cancelled: { label: 'Cancelled', color: 'text-red-400     bg-red-400/10     border-red-400/30' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, color: '' };
  return <Badge variant="outline" className={`text-xs capitalize ${cfg.color}`}>{cfg.label}</Badge>;
}

// ── create dialog ──────────────────────────────────────────────────────────────
function CreateRunDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedBills, setSelectedBills] = useState<EligibleBill[]>([]);

  const { register, handleSubmit, setValue, watch, control, formState: { errors } } = useForm<CreateRunForm>({
    resolver: zodResolver(createRunSchema),
    defaultValues: { name: '', treasuryAccountId: '', scheduledDate: '', notes: '', items: [] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const { data: accounts = [] } = useQuery<TreasuryAccount[]>({
    queryKey: ['/api/treasury-accounts', 'active'],
    queryFn: () => apiRequest('GET', '/api/treasury-accounts?status=active').then(r => r.json()),
  });

  const { data: eligibleBills = [] } = useQuery<EligibleBill[]>({
    queryKey: ['/api/payment-runs/eligible-bills'],
    queryFn: () => apiRequest('GET', '/api/payment-runs/eligible-bills').then(r => r.json()),
  });

  const selectedAccountId = watch('treasuryAccountId');
  const selectedAccount   = accounts.find(a => String(a.id) === selectedAccountId);

  function addBill(bill: EligibleBill) {
    if (selectedBills.find(b => b.id === bill.id)) return;
    setSelectedBills(prev => [...prev, bill]);
    append({ vendorBillId: String(bill.id), amount: bill.outstanding, currency: bill.currency });
  }

  function removeBill(index: number) {
    const bill = selectedBills[index];
    setSelectedBills(prev => prev.filter((_, i) => i !== index));
    remove(index);
  }

  const totalAmount = fields.reduce((s, f, i) => {
    const v = watch(`items.${i}.amount`);
    return s + (parseFloat(v) || 0);
  }, 0);

  const balanceAfter = selectedAccount
    ? parseFloat(selectedAccount.currentBalance) - totalAmount
    : null;

  const mutation = useMutation({
    mutationFn: (data: CreateRunForm) =>
      apiRequest('POST', '/api/payment-runs', {
        ...data,
        items: data.items.map(i => ({
          vendorBillId: parseInt(i.vendorBillId, 10),
          amount:       parseFloat(i.amount),
          currency:     i.currency,
        })),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Payment run created" });
      qc.invalidateQueries({ queryKey: ['/api/payment-runs'] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const unselectedBills = eligibleBills.filter(b => !selectedBills.find(s => s.id === b.id));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Payment Run</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-5">

          {/* Run details */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Run Name *</Label>
              <Input {...register('name')} placeholder="e.g. July 2026 Vendor Payments" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Source Treasury Account *</Label>
              <Select value={selectedAccountId} onValueChange={v => setValue('treasuryAccountId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account…" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name} ({a.currency} · {fmt(a.currentBalance, a.currency)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.treasuryAccountId && <p className="text-xs text-destructive">{errors.treasuryAccountId.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Scheduled Date</Label>
              <Input type="date" {...register('scheduledDate')} />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Textarea {...register('notes')} rows={2} placeholder="Optional run notes" />
            </div>
          </div>

          <Separator />

          {/* Bill selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Select Bills to Pay</Label>
              {errors.items && <p className="text-xs text-destructive">{(errors.items as any).message}</p>}
            </div>

            {/* Available bills */}
            {unselectedBills.length > 0 && (
              <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                {unselectedBills.map(bill => (
                  <div
                    key={bill.id}
                    className="flex items-center justify-between px-3 py-2 hover:bg-muted/30 cursor-pointer"
                    onClick={() => addBill(bill)}
                  >
                    <div>
                      <span className="text-sm font-mono text-muted-foreground">{bill.billNumber}</span>
                      <span className="ml-2 text-sm">{bill.partnerName}</span>
                      {bill.dueDate && (
                        <span className="ml-2 text-xs text-muted-foreground">due {bill.dueDate}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-amber-400">
                        {fmt(bill.outstanding, bill.currency)} outstanding
                      </span>
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {unselectedBills.length === 0 && fields.length === 0 && (
              <p className="text-xs text-muted-foreground">No eligible bills found (approved or partially paid, not already in a run).</p>
            )}

            {/* Selected items */}
            {fields.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Selected Bills</p>
                {fields.map((field, i) => {
                  const bill = selectedBills[i];
                  return (
                    <div key={field.id} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-mono text-muted-foreground">{bill?.billNumber}</span>
                        <span className="ml-2 text-sm">{bill?.partnerName}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{bill?.currency}</span>
                        <Input
                          type="number"
                          step="0.01"
                          className="w-32 h-7 text-sm"
                          {...register(`items.${i}.amount`)}
                        />
                        <Button
                          type="button" variant="ghost" size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeBill(i)}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Totals */}
          {fields.length > 0 && (
            <div className="bg-muted/20 rounded-lg px-4 py-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total to Pay</span>
                <span className="font-bold text-amber-400">{fmt(totalAmount, selectedAccount?.currency)}</span>
              </div>
              {selectedAccount && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Account Balance</span>
                    <span>{fmt(selectedAccount.currentBalance, selectedAccount.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Balance After</span>
                    <span className={balanceAfter !== null && balanceAfter < 0 ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                      {balanceAfter !== null ? fmt(balanceAfter, selectedAccount.currency) : '—'}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || fields.length === 0}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Create Payment Run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── detail view ────────────────────────────────────────────────────────────────
function PaymentRunDetail({
  runId, onBack,
}: { runId: number; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const { data: run, isLoading } = useQuery<PaymentRunDetail>({
    queryKey: ['/api/payment-runs', runId],
    queryFn: () => apiRequest('GET', `/api/payment-runs/${runId}`).then(r => r.json()),
  });

  function transition(action: string) {
    apiRequest('POST', `/api/payment-runs/${runId}/${action}`)
      .then(r => r.json())
      .then(() => {
        toast({ title: `Run ${action}d` });
        qc.invalidateQueries({ queryKey: ['/api/payment-runs'] });
        qc.invalidateQueries({ queryKey: ['/api/payment-runs', runId] });
        setConfirmAction(null);
      })
      .catch((e: any) => {
        toast({ title: "Error", description: e.message, variant: "destructive" });
        setConfirmAction(null);
      });
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  if (!run) return null;

  const canReview   = run.status === 'draft';
  const canApprove  = run.status === 'reviewed';
  const canExecute  = run.status === 'approved';
  const canComplete = run.status === 'executed';
  const canCancel   = !['executed','completed','cancelled'].includes(run.status);

  const includedItems = run.items.filter(i => i.itemStatus === 'included' || i.itemStatus === 'paid');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{run.name}</h2>
              <StatusBadge status={run.status} />
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{run.runNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canReview   && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfirmAction('review')}><ClipboardList className="h-3.5 w-3.5" /> Mark Reviewed</Button>}
          {canApprove  && <Button size="sm" variant="outline" className="gap-1.5 text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10" onClick={() => setConfirmAction('approve')}><CheckCircle className="h-3.5 w-3.5" /> Approve</Button>}
          {canExecute  && <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700" onClick={() => setConfirmAction('execute')}><Play className="h-3.5 w-3.5" /> Execute</Button>}
          {canComplete && <Button size="sm" variant="outline" onClick={() => setConfirmAction('complete')}>Mark Completed</Button>}
          {canCancel   && <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirmAction('cancel')}><XCircle className="h-3.5 w-3.5" /> Cancel</Button>}
        </div>
      </div>

      {/* Run details card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Treasury Account', value: run.accountName ?? '—' },
          { label: 'Currency',         value: run.currency },
          { label: 'Total Amount',     value: fmt(run.totalAmount, run.currency), color: 'text-amber-400 font-bold' },
          { label: 'Scheduled Date',   value: run.scheduledDate ?? '—' },
          { label: 'Reviewed By',      value: run.reviewedBy ?? '—' },
          { label: 'Approved By',      value: run.approvedBy ?? '—' },
          { label: 'Executed By',      value: run.executedBy ?? '—' },
          { label: 'Created By',       value: run.createdBy },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-sm font-medium mt-0.5 ${color ?? ''}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {run.executionNotes && (
        <Card><CardContent className="pt-3 pb-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Execution Notes</p>
          <p className="text-sm">{run.executionNotes}</p>
        </CardContent></Card>
      )}

      {/* Items table */}
      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Bills — {includedItems.length} item{includedItems.length !== 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Pay Amount</TableHead>
                <TableHead className="w-24">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {includedItems.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/20">
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.billNumber}</TableCell>
                  <TableCell className="text-sm">{item.partnerName ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.billDueDate ?? '—'}</TableCell>
                  <TableCell className="text-right text-sm text-amber-400">{fmt(item.billOutstanding, item.currency)}</TableCell>
                  <TableCell className="text-right font-semibold text-sm">{fmt(item.amount, item.currency)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${item.itemStatus === 'paid' ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' : 'text-slate-400 border-slate-400/30'}`}>
                      {item.itemStatus}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Confirm dialogs */}
      {confirmAction && (
        <AlertDialog open onOpenChange={() => setConfirmAction(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="capitalize">{confirmAction} Payment Run?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmAction === 'execute'
                  ? `This will create vendor payments for all ${includedItems.length} included bills, totalling ${fmt(run.totalAmount, run.currency)}, and reduce the treasury account balance accordingly. This cannot be undone.`
                  : confirmAction === 'cancel'
                  ? 'The run will be cancelled. Included bills will be released back to eligible status.'
                  : `Confirm moving this run to ${confirmAction}.`
                }
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={confirmAction === 'cancel' || confirmAction === 'execute' ? 'bg-destructive hover:bg-destructive/90' : ''}
                onClick={() => transition(confirmAction)}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────
export default function PaymentRunsPage() {
  const [selectedId, setSelectedId]  = useState<number | null>(null);
  const [statusFilter, setStatus]    = useState('');
  const [createOpen, setCreateOpen]  = useState(false);
  const [deleteTarget, setDelTarget] = useState<PaymentRunSummary | null>(null);

  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: runs = [], isLoading } = useQuery<PaymentRunSummary[]>({
    queryKey: ['/api/payment-runs'],
    queryFn: () => apiRequest('GET', '/api/payment-runs').then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest('DELETE', `/api/payment-runs/${id}`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Run deleted" });
      qc.invalidateQueries({ queryKey: ['/api/payment-runs'] });
      setDelTarget(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (selectedId !== null) {
    return (
      <div className="p-6">
        <PaymentRunDetail runId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  const filtered = statusFilter ? runs.filter(r => r.status === statusFilter) : runs;

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SendHorizontal className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Payment Runs</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Batch vendor payment runs — select bills, review, approve and execute.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New Run
        </Button>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter || '_all'} onValueChange={v => setStatus(v === '_all' ? '' : v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All statuses</SelectItem>
            {Object.entries(STATUS_CFG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        {isLoading ? (
          <CardContent className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        ) : filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
            <SendHorizontal className="h-8 w-8 opacity-20" />
            <p className="text-sm">No payment runs found. Create one to start paying vendors.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Run No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="w-14 text-center">Bills</TableHead>
                <TableHead className="text-right w-36">Total</TableHead>
                <TableHead className="w-28">Scheduled</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(run => (
                <TableRow
                  key={run.id}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => setSelectedId(run.id)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">{run.runNumber}</TableCell>
                  <TableCell className="font-medium text-sm">{run.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{run.accountName ?? '—'}</TableCell>
                  <TableCell className="text-center text-sm">{run.itemCount}</TableCell>
                  <TableCell className="text-right font-semibold text-sm text-amber-400">
                    {fmt(run.totalAmount, run.currency)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{run.scheduledDate ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={run.status} /></TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {createOpen && <CreateRunDialog onClose={() => setCreateOpen(false)} />}

      {deleteTarget && (
        <AlertDialog open onOpenChange={() => setDelTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete payment run?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{deleteTarget.name}</strong> ({deleteTarget.runNumber}) will be deleted.
                Only draft or cancelled runs can be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
              >Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
