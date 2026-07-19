import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Landmark, Plus, Search, Loader2, Pencil, Trash2, RefreshCw } from "lucide-react";

// ── types ──────────────────────────────────────────────────────────────────────
interface TreasuryAccount {
  id:                 number;
  accountNumber:      string;
  name:               string;
  type:               string;
  custodyType:        string | null;
  currency:           string;
  institutionName:    string | null;
  accountIdentifier:  string | null;
  network:            string | null;
  openingBalance:     string;
  currentBalance:     string;
  isDefault:          boolean;
  status:             string;
  notes:              string | null;
  createdAt:          string;
}

// ── form schema ────────────────────────────────────────────────────────────────
const bankAccountSchema = z.object({
  name:               z.string().min(1, "Account name is required"),
  type:               z.literal("bank"),
  currency:           z.string().min(1, "Currency is required"),
  institutionName:    z.string().optional(),
  accountIdentifier:  z.string().optional(),
  openingBalance:     z.string().optional(),
  isDefault:          z.boolean().optional(),
  status:             z.enum(["active","inactive","frozen"]),
  notes:              z.string().optional(),
});
type BankAccountForm = z.infer<typeof bankAccountSchema>;

// ── helpers ────────────────────────────────────────────────────────────────────
function fmt(n: string | number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n));
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    active:   'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
    inactive: 'text-slate-400   bg-slate-400/10   border-slate-400/30',
    frozen:   'text-red-400     bg-red-400/10     border-red-400/30',
  };
  return (
    <Badge variant="outline" className={`text-xs capitalize ${cfg[status] ?? ''}`}>
      {status}
    </Badge>
  );
}

// ── update balance dialog ──────────────────────────────────────────────────────
function UpdateBalanceDialog({
  account, onClose,
}: { account: TreasuryAccount; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [balance, setBalance] = useState(account.currentBalance);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest('PATCH', `/api/treasury-accounts/${account.id}/balance`, { currentBalance: balance })
        .then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Balance updated" });
      qc.invalidateQueries({ queryKey: ['/api/treasury-accounts'] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Update Balance — {account.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label>Current Balance ({account.currency})</Label>
          <Input
            type="number"
            step="0.01"
            value={balance}
            onChange={e => setBalance(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── create / edit dialog ───────────────────────────────────────────────────────
function BankAccountDialog({
  account, onClose,
}: { account?: TreasuryAccount; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<BankAccountForm>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: {
      name:              account?.name              ?? '',
      type:              'bank',
      currency:          account?.currency          ?? 'USD',
      institutionName:   account?.institutionName   ?? '',
      accountIdentifier: account?.accountIdentifier ?? '',
      openingBalance:    account?.openingBalance    ?? '0',
      isDefault:         account?.isDefault         ?? false,
      status:            (account?.status as any)   ?? 'active',
      notes:             account?.notes             ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: BankAccountForm) => {
      const payload = { ...data, type: 'bank' };
      if (account) {
        return apiRequest('PATCH', `/api/treasury-accounts/${account.id}`, payload).then(r => r.json());
      }
      return apiRequest('POST', '/api/treasury-accounts', payload).then(r => r.json());
    },
    onSuccess: () => {
      toast({ title: account ? "Account updated" : "Account created" });
      qc.invalidateQueries({ queryKey: ['/api/treasury-accounts'] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{account ? 'Edit Bank Account' : 'New Bank Account'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Account Name *</Label>
              <Input {...register('name')} placeholder="e.g. Emirates NBD Current" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Institution / Bank</Label>
              <Input {...register('institutionName')} placeholder="Emirates NBD" />
            </div>

            <div className="space-y-1.5">
              <Label>Account Number / IBAN</Label>
              <Input {...register('accountIdentifier')} placeholder="AE07 0331 2345 6789 0123 456" />
            </div>

            <div className="space-y-1.5">
              <Label>Currency *</Label>
              <Input {...register('currency')} placeholder="USD" maxLength={10} />
            </div>

            <div className="space-y-1.5">
              <Label>Opening Balance</Label>
              <Input type="number" step="0.01" {...register('openingBalance')} />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={watch('status')} onValueChange={v => setValue('status', v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="frozen">Frozen</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Textarea {...register('notes')} rows={2} placeholder="Optional notes" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {account ? 'Save Changes' : 'Create Account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────
export default function BankAccountsPage() {
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatus]     = useState('');
  const [createOpen, setCreateOpen]   = useState(false);
  const [editTarget, setEditTarget]   = useState<TreasuryAccount | null>(null);
  const [balTarget, setBalTarget]     = useState<TreasuryAccount | null>(null);
  const [deleteTarget, setDelTarget]  = useState<TreasuryAccount | null>(null);

  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: accounts = [], isLoading } = useQuery<TreasuryAccount[]>({
    queryKey: ['/api/treasury-accounts', { type: 'bank' }],
    queryFn: () =>
      apiRequest('GET', '/api/treasury-accounts?type=bank').then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest('DELETE', `/api/treasury-accounts/${id}`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Account removed" });
      qc.invalidateQueries({ queryKey: ['/api/treasury-accounts'] });
      setDelTarget(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = accounts.filter(a => {
    const matchSearch = !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.institutionName ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (a.accountIdentifier ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalBalance = accounts
    .filter(a => a.status === 'active')
    .reduce((s, a) => s + Number(a.currentBalance), 0);

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Landmark className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Bank Accounts</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Treasury bank accounts — current, savings and escrow.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Account
        </Button>
      </div>

      {/* Summary card */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Balance (Active Accounts)</p>
              <p className="text-2xl font-bold mt-1 text-emerald-400">
                {fmt(totalBalance)}
              </p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <p>{accounts.filter(a => a.status === 'active').length} active account{accounts.filter(a => a.status === 'active').length !== 1 ? 's' : ''}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search accounts…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter || '_all'} onValueChange={v => setStatus(v === '_all' ? '' : v)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="frozen">Frozen</SelectItem>
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
            <Landmark className="h-8 w-8 opacity-20" />
            <p className="text-sm">No bank accounts found.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Account No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Institution</TableHead>
                <TableHead>Identifier</TableHead>
                <TableHead className="w-16">CCY</TableHead>
                <TableHead className="text-right w-36">Balance</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(a => (
                <TableRow key={a.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs text-muted-foreground">{a.accountNumber}</TableCell>
                  <TableCell className="font-medium text-sm">
                    {a.name}
                    {a.isDefault && (
                      <Badge variant="outline" className="ml-2 text-xs text-sky-400 border-sky-400/30 bg-sky-400/10">Default</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.institutionName ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground max-w-40 truncate">{a.accountIdentifier ?? '—'}</TableCell>
                  <TableCell className="text-sm">{a.currency}</TableCell>
                  <TableCell className="text-right font-semibold text-sm text-emerald-400">
                    {fmt(a.currentBalance, a.currency)}
                  </TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="Update balance"
                        onClick={() => setBalTarget(a)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => setEditTarget(a)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDelTarget(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Dialogs */}
      {createOpen && <BankAccountDialog onClose={() => setCreateOpen(false)} />}
      {editTarget  && <BankAccountDialog account={editTarget} onClose={() => setEditTarget(null)} />}
      {balTarget   && <UpdateBalanceDialog account={balTarget} onClose={() => setBalTarget(null)} />}

      {deleteTarget && (
        <AlertDialog open onOpenChange={() => setDelTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove bank account?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{deleteTarget.name}</strong> ({deleteTarget.accountNumber}) will be soft-deleted.
                Historical records are preserved. This cannot be undone here.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
