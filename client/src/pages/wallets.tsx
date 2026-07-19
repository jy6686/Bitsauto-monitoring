import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
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
import { Wallet, Plus, Search, Loader2, Pencil, Trash2, RefreshCw } from "lucide-react";

// ── types ──────────────────────────────────────────────────────────────────────
interface TreasuryAccount {
  id:                 number;
  accountNumber:      string;
  name:               string;
  type:               string;
  custodyType:        string | null;
  currency:           string;
  institutionName:    string | null;  // exchange name for custodial
  accountIdentifier:  string | null;  // wallet address for on-chain
  network:            string | null;  // TRC20, ERC20, etc.
  openingBalance:     string;
  currentBalance:     string;
  isDefault:          boolean;
  status:             string;
  notes:              string | null;
}

// ── form schema ────────────────────────────────────────────────────────────────
const walletSchema = z.object({
  name:               z.string().min(1, "Wallet name is required"),
  custodyType:        z.enum(["custodial","on_chain"]),
  currency:           z.string().min(1, "Currency is required"),
  institutionName:    z.string().optional(),   // exchange name
  accountIdentifier:  z.string().optional(),   // wallet address (on-chain)
  network:            z.string().optional(),   // TRC20, ERC20, BEP20…
  openingBalance:     z.string().optional(),
  status:             z.enum(["active","inactive","frozen"]),
  notes:              z.string().optional(),
});
type WalletForm = z.infer<typeof walletSchema>;

// ── helpers ────────────────────────────────────────────────────────────────────
function fmt(n: string | number, currency = 'USDT') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n));
  } catch {
    return `${Number(n).toLocaleString()} ${currency}`;
  }
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

function CustodyBadge({ custodyType }: { custodyType: string | null }) {
  if (!custodyType) return null;
  const cfg: Record<string, string> = {
    custodial: 'text-violet-400 bg-violet-400/10 border-violet-400/30',
    on_chain:  'text-amber-400  bg-amber-400/10  border-amber-400/30',
  };
  return (
    <Badge variant="outline" className={`text-xs ${cfg[custodyType] ?? ''}`}>
      {custodyType === 'on_chain' ? 'On-Chain' : 'Custodial'}
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
          <Input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} />
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
function WalletDialog({
  account, onClose,
}: { account?: TreasuryAccount; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<WalletForm>({
    resolver: zodResolver(walletSchema),
    defaultValues: {
      name:              account?.name              ?? '',
      custodyType:       (account?.custodyType as any) ?? 'custodial',
      currency:          account?.currency          ?? 'USDT',
      institutionName:   account?.institutionName   ?? '',
      accountIdentifier: account?.accountIdentifier ?? '',
      network:           account?.network           ?? '',
      openingBalance:    account?.openingBalance    ?? '0',
      status:            (account?.status as any)   ?? 'active',
      notes:             account?.notes             ?? '',
    },
  });

  const custodyType = watch('custodyType');

  const mutation = useMutation({
    mutationFn: (data: WalletForm) => {
      const payload = { ...data, type: 'wallet' };
      if (account) {
        return apiRequest('PATCH', `/api/treasury-accounts/${account.id}`, payload).then(r => r.json());
      }
      return apiRequest('POST', '/api/treasury-accounts', payload).then(r => r.json());
    },
    onSuccess: () => {
      toast({ title: account ? "Wallet updated" : "Wallet created" });
      qc.invalidateQueries({ queryKey: ['/api/treasury-accounts'] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{account ? 'Edit Wallet' : 'New Wallet'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">

            <div className="col-span-2 space-y-1.5">
              <Label>Wallet Name *</Label>
              <Input {...register('name')} placeholder="e.g. Binance USDT Main" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Custody Type *</Label>
              <Select value={custodyType} onValueChange={v => setValue('custodyType', v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="custodial">Custodial (Exchange)</SelectItem>
                  <SelectItem value="on_chain">On-Chain (Self-Custody)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Currency *</Label>
              <Input {...register('currency')} placeholder="USDT" maxLength={10} />
            </div>

            {custodyType === 'custodial' ? (
              <div className="col-span-2 space-y-1.5">
                <Label>Exchange Name</Label>
                <Input {...register('institutionName')} placeholder="Binance, OKX, Bybit…" />
              </div>
            ) : (
              <>
                <div className="col-span-2 space-y-1.5">
                  <Label>Wallet Address</Label>
                  <Input {...register('accountIdentifier')} placeholder="T... or 0x..." className="font-mono text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label>Network</Label>
                  <Input {...register('network')} placeholder="TRC20, ERC20, BEP20…" />
                </div>
                <div className="space-y-1.5"></div>
              </>
            )}

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
              {account ? 'Save Changes' : 'Create Wallet'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────
export default function WalletsPage() {
  const [search, setSearch]          = useState('');
  const [custodyFilter, setCustody]  = useState('');
  const [statusFilter, setStatus]    = useState('');
  const [createOpen, setCreateOpen]  = useState(false);
  const [editTarget, setEditTarget]  = useState<TreasuryAccount | null>(null);
  const [balTarget, setBalTarget]    = useState<TreasuryAccount | null>(null);
  const [deleteTarget, setDelTarget] = useState<TreasuryAccount | null>(null);

  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: wallets = [], isLoading } = useQuery<TreasuryAccount[]>({
    queryKey: ['/api/treasury-accounts', { type: 'wallet' }],
    queryFn: () =>
      apiRequest('GET', '/api/treasury-accounts?type=wallet').then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest('DELETE', `/api/treasury-accounts/${id}`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Wallet removed" });
      qc.invalidateQueries({ queryKey: ['/api/treasury-accounts'] });
      setDelTarget(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = wallets.filter(w => {
    const matchSearch = !search ||
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      (w.institutionName ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (w.accountIdentifier ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (w.network ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCustody = !custodyFilter || w.custodyType === custodyFilter;
    const matchStatus  = !statusFilter  || w.status === statusFilter;
    return matchSearch && matchCustody && matchStatus;
  });

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wallet className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Wallets</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Custodial exchange wallets and on-chain self-custody wallets.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Wallet
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search wallets…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={custodyFilter || '_all'} onValueChange={v => setCustody(v === '_all' ? '' : v)}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Custody type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All types</SelectItem>
            <SelectItem value="custodial">Custodial</SelectItem>
            <SelectItem value="on_chain">On-Chain</SelectItem>
          </SelectContent>
        </Select>
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
            <Wallet className="h-8 w-8 opacity-20" />
            <p className="text-sm">No wallets found. Add a custodial or on-chain wallet to get started.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Wallet No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Custody</TableHead>
                <TableHead>Exchange / Address</TableHead>
                <TableHead className="w-24">Network</TableHead>
                <TableHead className="w-16">CCY</TableHead>
                <TableHead className="text-right w-36">Balance</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(w => (
                <TableRow key={w.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs text-muted-foreground">{w.accountNumber}</TableCell>
                  <TableCell className="font-medium text-sm">{w.name}</TableCell>
                  <TableCell><CustodyBadge custodyType={w.custodyType} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                    {w.custodyType === 'custodial'
                      ? (w.institutionName ?? '—')
                      : (w.accountIdentifier
                          ? <span className="font-mono text-xs">{w.accountIdentifier}</span>
                          : '—'
                        )
                    }
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{w.network ?? '—'}</TableCell>
                  <TableCell className="text-sm">{w.currency}</TableCell>
                  <TableCell className="text-right font-semibold text-sm text-amber-400">
                    {fmt(w.currentBalance, w.currency)}
                  </TableCell>
                  <TableCell><StatusBadge status={w.status} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="Update balance"
                        onClick={() => setBalTarget(w)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => setEditTarget(w)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDelTarget(w)}
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
      {createOpen && <WalletDialog onClose={() => setCreateOpen(false)} />}
      {editTarget  && <WalletDialog account={editTarget} onClose={() => setEditTarget(null)} />}
      {balTarget   && <UpdateBalanceDialog account={balTarget} onClose={() => setBalTarget(null)} />}

      {deleteTarget && (
        <AlertDialog open onOpenChange={() => setDelTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove wallet?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{deleteTarget.name}</strong> ({deleteTarget.accountNumber}) will be soft-deleted.
                Historical records are preserved.
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
