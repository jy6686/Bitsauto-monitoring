import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Wallet, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  TrendingUp, Plus, Settings2, Loader2, Bell, BellOff,
  CreditCard, ShieldAlert, Minus, Server, Hash, Shield,
  Network, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface BalanceAccount {
  iAccount: number;
  username: string;
  balance: number;
  creditLimit: number;
  threshold: number | null;
  notifyByEmail: boolean | undefined;
  status: "healthy" | "warning" | "critical";
  currency?: string;
  // Extended details
  maxSessions: number | null;
  prefix: string | null;
  allowedIps: string[];
}

interface BalanceMonitorResponse {
  success: boolean;
  accounts: BalanceAccount[];
  error?: string;
  fromCache?: boolean;
}

function StatusBadge({ status }: { status: BalanceAccount["status"] }) {
  if (status === "critical")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/25">
        <XCircle className="w-3 h-3" /> Critical
      </span>
    );
  if (status === "warning")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">
        <AlertTriangle className="w-3 h-3" /> Warning
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
      <CheckCircle2 className="w-3 h-3" /> Healthy
    </span>
  );
}

function BalanceBar({ balance, creditLimit, threshold }: { balance: number; creditLimit: number; threshold: number | null }) {
  const maxVal = Math.max(creditLimit, balance, threshold ?? 0, 1);
  const balPct = Math.min(100, Math.max(0, (balance / maxVal) * 100));
  const thrPct = threshold !== null ? Math.min(100, Math.max(0, (threshold / maxVal) * 100)) : null;

  const barColor =
    balance <= 0 ? "bg-rose-500" :
    threshold !== null && balance <= threshold ? "bg-amber-500" :
    "bg-emerald-500";

  return (
    <div className="relative w-full h-2.5 bg-muted/40 rounded-full overflow-visible">
      <div
        className={cn("h-2.5 rounded-full transition-all duration-500", barColor)}
        style={{ width: `${balPct}%` }}
      />
      {thrPct !== null && (
        <div
          className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-amber-400 rounded-full z-10"
          style={{ left: `${thrPct}%` }}
          title={`Low-balance threshold: $${threshold}`}
        />
      )}
    </div>
  );
}

// ─── Top-Up / Debit Modal ─────────────────────────────────────────────────────

function TopUpModal({
  account,
  open,
  onClose,
}: {
  account: BalanceAccount;
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const actionMut = useMutation({
    mutationFn: (body: { amount: number; currency: string; paymentNotes?: string }) =>
      apiRequest("POST", `/api/sippy/accounts/${account.iAccount}/${mode === "credit" ? "credit" : "debit"}`, body),
    onSuccess: () => {
      toast({
        title: mode === "credit" ? "Top-up applied" : "Debit applied",
        description: `${account.currency ?? "USD"} ${amount} ${mode === "credit" ? "credited to" : "debited from"} ${account.username}.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/sippy/balance-monitor"] });
      setAmount("");
      setNote("");
      onClose();
    },
    onError: (e: any) => {
      toast({
        title: `${mode === "credit" ? "Top-up" : "Debit"} failed`,
        description: e.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive number.", variant: "destructive" });
      return;
    }
    actionMut.mutate({ amount: amt, currency: account.currency ?? "USD", paymentNotes: note || undefined });
  };

  const isCredit = mode === "credit";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setAmount(""); setNote(""); setMode("credit"); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCredit
              ? <Plus className="w-4 h-4 text-emerald-400" />
              : <Minus className="w-4 h-4 text-rose-400" />}
            {isCredit ? "Top-Up" : "Debit"} — {account.username}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              data-testid="toggle-credit-mode"
              onClick={() => setMode("credit")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors",
                isCredit
                  ? "bg-emerald-600/20 text-emerald-300 border-r border-emerald-500/30"
                  : "bg-muted/20 text-muted-foreground hover:bg-muted/40 border-r border-border"
              )}
            >
              <Plus className="w-3.5 h-3.5" /> Top-Up (Credit)
            </button>
            <button
              data-testid="toggle-debit-mode"
              onClick={() => setMode("debit")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors",
                !isCredit
                  ? "bg-rose-600/20 text-rose-300"
                  : "bg-muted/20 text-muted-foreground hover:bg-muted/40"
              )}
            >
              <Minus className="w-3.5 h-3.5" /> Debit
            </button>
          </div>

          {!isCredit && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/8 border border-rose-500/20 text-rose-300 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>Debit reduces the account balance. This action cannot be undone from this interface.</span>
            </div>
          )}

          <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-muted/30 border border-border/50">
            <span className="text-muted-foreground">Current balance</span>
            <span className={cn("font-bold font-mono", account.balance <= 0 ? "text-rose-400" : "text-emerald-400")}>
              {account.currency ?? "USD"} {account.balance.toFixed(4)}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="action-amount">
              Amount to {isCredit ? "add" : "deduct"} ({account.currency ?? "USD"})
            </Label>
            <Input
              id="action-amount"
              data-testid="input-topup-amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="e.g. 50.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="action-note">Note (optional)</Label>
            <Input
              id="action-note"
              data-testid="input-topup-note"
              placeholder={isCredit ? "e.g. Monthly top-up" : "e.g. Correction"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setAmount(""); setNote(""); setMode("credit"); }} disabled={actionMut.isPending}>
            Cancel
          </Button>
          <Button
            data-testid="button-confirm-topup"
            onClick={handleSubmit}
            disabled={actionMut.isPending || !amount}
            className={isCredit
              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
              : "bg-rose-600 hover:bg-rose-700 text-white"}
          >
            {actionMut.isPending
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : isCredit
                ? <Plus className="w-4 h-4 mr-2" />
                : <Minus className="w-4 h-4 mr-2" />}
            {isCredit ? "Apply Top-Up" : "Apply Debit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Credit Adjustment Modal ──────────────────────────────────────────────────

function CreditAdjustModal({
  account,
  open,
  onClose,
}: {
  account: BalanceAccount;
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"set" | "increase" | "decrease">("set");
  const [amount, setAmount] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const computedNewLimit = (): number | null => {
    const n = parseFloat(amount);
    if (isNaN(n) || n < 0) return null;
    if (mode === "set") return n;
    if (mode === "increase") return Math.max(0, account.creditLimit + n);
    if (mode === "decrease") return Math.max(0, account.creditLimit - n);
    return null;
  };

  const newLimit = computedNewLimit();

  const adjustMut = useMutation({
    mutationFn: (body: { creditLimit: number }) =>
      apiRequest("PATCH", `/api/sippy/accounts/${account.iAccount}/credit-limit`, body),
    onSuccess: () => {
      toast({
        title: "Credit limit updated",
        description: `Credit limit for ${account.username} set to ${account.currency ?? "USD"} ${newLimit?.toFixed(2)}.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/sippy/balance-monitor"] });
      setAmount("");
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Update failed", description: e.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (newLimit === null || newLimit < 0) {
      toast({ title: "Invalid amount", description: "Enter a valid non-negative number.", variant: "destructive" });
      return;
    }
    adjustMut.mutate({ creditLimit: newLimit });
  };

  const modeClass = (m: typeof mode) =>
    cn(
      "flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors",
      mode === m
        ? m === "set"
          ? "bg-blue-600/20 text-blue-300 border-r border-blue-500/30"
          : m === "increase"
            ? "bg-emerald-600/20 text-emerald-300 border-r border-emerald-500/30"
            : "bg-rose-600/20 text-rose-300"
        : "bg-muted/20 text-muted-foreground hover:bg-muted/40 border-r border-border"
    );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setAmount(""); setMode("set"); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-blue-400" />
            Credit Adjustment — {account.username}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button data-testid="credit-mode-set" onClick={() => setMode("set")} className={modeClass("set")}>
              Set
            </button>
            <button data-testid="credit-mode-increase" onClick={() => setMode("increase")} className={modeClass("increase")}>
              <Plus className="w-3.5 h-3.5" /> Increase
            </button>
            <button data-testid="credit-mode-decrease" onClick={() => setMode("decrease")} className={cn(modeClass("decrease"), "border-r-0")}>
              <Minus className="w-3.5 h-3.5" /> Decrease
            </button>
          </div>

          {/* Current values */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5 p-3 rounded-lg bg-muted/30 border border-border/50">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Current Balance</span>
              <span className={cn("text-sm font-bold font-mono", account.balance <= 0 ? "text-rose-400" : "text-emerald-400")}>
                {account.currency ?? "USD"} {account.balance.toFixed(4)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 p-3 rounded-lg bg-muted/30 border border-border/50">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Current Limit</span>
              <span className="text-sm font-bold font-mono text-blue-400">
                {account.currency ?? "USD"} {account.creditLimit.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Amount input */}
          <div className="space-y-1.5">
            <Label htmlFor="credit-amount">
              {mode === "set" ? "New credit limit" : mode === "increase" ? "Increase by" : "Decrease by"} ({account.currency ?? "USD"})
            </Label>
            <Input
              id="credit-amount"
              data-testid="input-credit-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder={mode === "set" ? `e.g. ${account.creditLimit.toFixed(2)}` : "e.g. 50.00"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {/* Preview */}
          {newLimit !== null && (
            <div className={cn(
              "flex items-center justify-between p-3 rounded-lg border text-sm",
              mode === "decrease" && newLimit < account.creditLimit
                ? "bg-rose-500/8 border-rose-500/20 text-rose-300"
                : "bg-emerald-500/8 border-emerald-500/20 text-emerald-300"
            )}>
              <span className="text-muted-foreground text-xs">New credit limit will be</span>
              <span className="font-bold font-mono">
                {account.currency ?? "USD"} {newLimit.toFixed(2)}
              </span>
            </div>
          )}

          {mode === "decrease" && newLimit !== null && newLimit === 0 && account.creditLimit > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 text-amber-300 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>Reducing to zero removes all prepaid credit from this account.</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setAmount(""); setMode("set"); }} disabled={adjustMut.isPending}>
            Cancel
          </Button>
          <Button
            data-testid="button-confirm-credit-adjust"
            onClick={handleSubmit}
            disabled={adjustMut.isPending || newLimit === null}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {adjustMut.isPending
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : <SlidersHorizontal className="w-4 h-4 mr-2" />}
            Apply Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Alert Config Modal ───────────────────────────────────────────────────────

function ThresholdModal({
  account,
  open,
  onClose,
}: {
  account: BalanceAccount;
  open: boolean;
  onClose: () => void;
}) {
  const [threshold, setThreshold] = useState(account.threshold !== null ? String(account.threshold) : "");
  const [notify, setNotify]       = useState(account.notifyByEmail ?? false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const patchMut = useMutation({
    mutationFn: (body: { threshold?: number | null; notifyByEmail?: boolean }) =>
      apiRequest("PATCH", `/api/sippy/accounts/${account.iAccount}/low-balance`, body),
    onSuccess: () => {
      toast({ title: "Alert settings saved", description: `Low-balance config updated for ${account.username}.` });
      qc.invalidateQueries({ queryKey: ["/api/sippy/balance-monitor"] });
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const thr = threshold === "" ? null : parseFloat(threshold);
    if (threshold !== "" && (isNaN(thr as number) || (thr as number) < 0)) {
      toast({ title: "Invalid threshold", description: "Enter a non-negative number or leave blank to disable.", variant: "destructive" });
      return;
    }
    patchMut.mutate({ threshold: thr, notifyByEmail: notify });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-blue-400" />
            Alert Settings — {account.username}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="thr-value">Low-balance threshold ({account.currency ?? "USD"})</Label>
            <p className="text-xs text-muted-foreground">When balance drops to or below this value, the account is flagged as Warning. Leave blank to disable.</p>
            <Input
              id="thr-value"
              data-testid="input-threshold"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 10.00 (blank = disabled)"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <button
              data-testid="toggle-notify-email"
              type="button"
              onClick={() => setNotify(!notify)}
              className={cn(
                "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                notify ? "bg-blue-600" : "bg-muted"
              )}
            >
              <span className={cn("pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", notify ? "translate-x-4" : "translate-x-0")} />
            </button>
            <div>
              <p className="text-sm font-medium">Email notification</p>
              <p className="text-xs text-muted-foreground">Sippy sends alert when balance hits threshold</p>
            </div>
            {notify ? <Bell className="w-4 h-4 text-blue-400 ml-auto" /> : <BellOff className="w-4 h-4 text-muted-foreground ml-auto" />}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={patchMut.isPending}>Cancel</Button>
          <Button
            data-testid="button-save-threshold"
            onClick={handleSave}
            disabled={patchMut.isPending}
          >
            {patchMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Settings2 className="w-4 h-4 mr-2" />}
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Account Card ─────────────────────────────────────────────────────────────

function AccountCard({ account }: { account: BalanceAccount }) {
  const [showTopUp, setShowTopUp]           = useState(false);
  const [showThreshold, setShowThreshold]   = useState(false);
  const [showCreditAdj, setShowCreditAdj]   = useState(false);
  const { role } = useAuth();
  const canEdit = role === "admin" || role === "management";

  const cur = account.currency ?? "USD";
  const cardBorder =
    account.status === "critical" ? "border-rose-500/30 bg-rose-500/5" :
    account.status === "warning"  ? "border-amber-500/30 bg-amber-500/5" :
    "border-border/50 bg-card";

  const portLabel =
    account.maxSessions === null  ? "—" :
    account.maxSessions === 0     ? "Unlimited" :
    account.maxSessions === -1    ? "Unlimited" :
    String(account.maxSessions);

  return (
    <>
      <div data-testid={`card-account-${account.iAccount}`} className={cn("rounded-xl border p-5 space-y-3.5 transition-all", cardBorder)}>

        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CreditCard className={cn("w-4 h-4", account.status === "critical" ? "text-rose-400" : account.status === "warning" ? "text-amber-400" : "text-emerald-400")} />
              <span data-testid={`text-account-name-${account.iAccount}`} className="font-semibold text-sm">{account.username}</span>
            </div>
            <span className="text-[11px] text-muted-foreground font-mono">iAccount={account.iAccount}</span>
          </div>
          <StatusBadge status={account.status} />
        </div>

        {/* Balance number */}
        <div className="space-y-1">
          <div className="flex items-end justify-between">
            <span data-testid={`text-balance-${account.iAccount}`} className={cn("text-2xl font-bold font-mono tracking-tight", account.balance <= 0 ? "text-rose-400" : account.balance <= (account.threshold ?? Infinity) ? "text-amber-400" : "text-emerald-400")}>
              {cur} {account.balance.toFixed(4)}
            </span>
            {account.creditLimit > 0 && (
              <span className="text-xs text-muted-foreground">limit: {cur} {account.creditLimit.toFixed(2)}</span>
            )}
          </div>
          <BalanceBar balance={account.balance} creditLimit={account.creditLimit} threshold={account.threshold} />
        </div>

        {/* Extra details grid */}
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          {/* Allocated Ports */}
          <div className="flex flex-col gap-0.5 p-2 rounded-lg bg-muted/20 border border-border/30">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
              <Server className="w-2.5 h-2.5" /> Ports
            </div>
            <span data-testid={`text-ports-${account.iAccount}`} className="text-xs font-semibold font-mono text-foreground">
              {portLabel}
            </span>
          </div>

          {/* Prefix */}
          <div className="flex flex-col gap-0.5 p-2 rounded-lg bg-muted/20 border border-border/30">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
              <Hash className="w-2.5 h-2.5" /> Prefix
            </div>
            <span data-testid={`text-prefix-${account.iAccount}`} className="text-xs font-semibold font-mono text-foreground truncate" title={account.prefix ?? undefined}>
              {account.prefix ?? "—"}
            </span>
          </div>

          {/* Allowed IPs count */}
          <div className="flex flex-col gap-0.5 p-2 rounded-lg bg-muted/20 border border-border/30">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
              <Shield className="w-2.5 h-2.5" /> IPs
            </div>
            <span data-testid={`text-ip-count-${account.iAccount}`} className="text-xs font-semibold font-mono text-foreground">
              {account.allowedIps.length > 0 ? account.allowedIps.length : "—"}
            </span>
          </div>
        </div>

        {/* Allowed IPs list (if any) */}
        {account.allowedIps.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium uppercase tracking-wide">
              <Network className="w-2.5 h-2.5" /> Allowed IPs
            </p>
            <div className="flex flex-wrap gap-1">
              {account.allowedIps.map((ip, i) => (
                <span
                  key={i}
                  data-testid={`badge-ip-${account.iAccount}-${i}`}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-blue-500/10 border border-blue-500/20 text-blue-300"
                >
                  {ip}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Threshold row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {account.threshold !== null ? (
              <>
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span>Alert at <span className="font-mono text-amber-400">{cur} {account.threshold.toFixed(2)}</span></span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3 h-3 text-muted-foreground/50" />
                <span className="text-muted-foreground/60">No threshold set</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {account.notifyByEmail ? (
              <Bell className="w-3 h-3 text-blue-400" />
            ) : (
              <BellOff className="w-3 h-3 text-muted-foreground/40" />
            )}
          </div>
        </div>

        {/* Actions */}
        {canEdit && (
          <div className="space-y-2 pt-0.5">
            <div className="flex gap-2">
              <Button
                data-testid={`button-topup-${account.iAccount}`}
                size="sm"
                className="flex-1 bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs h-8"
                onClick={() => setShowTopUp(true)}
              >
                <Plus className="w-3 h-3 mr-1" /> Top-Up / Debit
              </Button>
              <Button
                data-testid={`button-configure-${account.iAccount}`}
                size="sm"
                variant="outline"
                className="flex-1 text-xs h-8"
                onClick={() => setShowThreshold(true)}
              >
                <Settings2 className="w-3 h-3 mr-1" /> Alert Config
              </Button>
            </div>
            <Button
              data-testid={`button-credit-adjust-${account.iAccount}`}
              size="sm"
              variant="outline"
              className="w-full text-xs h-8 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
              onClick={() => setShowCreditAdj(true)}
            >
              <SlidersHorizontal className="w-3 h-3 mr-1" /> Credit Adjustment
            </Button>
          </div>
        )}
      </div>

      <TopUpModal account={account} open={showTopUp} onClose={() => setShowTopUp(false)} />
      <ThresholdModal account={account} open={showThreshold} onClose={() => setShowThreshold(false)} />
      <CreditAdjustModal account={account} open={showCreditAdj} onClose={() => setShowCreditAdj(false)} />
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BalanceMonitorPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isViewer = role === 'viewer';

  const { data, isLoading, error, dataUpdatedAt } = useQuery<BalanceMonitorResponse>({
    queryKey: ["/api/sippy/balance-monitor"],
    refetchInterval: 5 * 60 * 1000,
  });

  // For viewers: fetch their assigned accounts (via KAM email match) to filter the list
  const { data: assignedAccountsData } = useQuery<{ kamId: number | null; kamName: string | null; accountIds: string[]; clientNames: string[] }>({
    queryKey: ["/api/user/assigned-accounts"],
    enabled: isViewer,
    staleTime: 60_000,
  });

  const allAccounts = data?.accounts ?? [];
  // Viewers with specific KAM account assignments see only their accounts;
  // if no KAM mapping exists, they see all accounts (balance_monitor was still granted by admin)
  const assignedIds = assignedAccountsData?.accountIds ?? [];
  const accounts = isViewer && assignedIds.length > 0
    ? allAccounts.filter(a => assignedIds.includes(String(a.iAccount)))
    : allAccounts;

  const criticalCount = accounts.filter((a) => a.status === "critical").length;
  const warningCount  = accounts.filter((a) => a.status === "warning").length;
  const healthyCount  = accounts.filter((a) => a.status === "healthy").length;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Wallet className="w-6 h-6 text-blue-400" />
            <h2 className="text-2xl font-bold tracking-tight">Account Balance Monitor</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Live balances · auto-refresh every 2 min
            {lastUpdated && <span className="ml-2 text-muted-foreground/60">· updated {lastUpdated}</span>}
          </p>
          {isViewer && assignedIds.length > 0 && assignedAccountsData?.kamName && (
            <p className="text-xs text-blue-400/80 mt-1 flex items-center gap-1">
              <Shield className="w-3 h-3" />
              Showing accounts assigned to {assignedAccountsData.kamName}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isLoading && accounts.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              {criticalCount > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-400 font-semibold">
                  <XCircle className="w-3 h-3" /> {criticalCount} Critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 font-semibold">
                  <AlertTriangle className="w-3 h-3" /> {warningCount} Warning
                </span>
              )}
              {healthyCount > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-3 h-3" /> {healthyCount} Healthy
                </span>
              )}
            </div>
          )}
          <Button
            data-testid="button-refresh-balances"
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["/api/sippy/balance-monitor"] })}
            disabled={isLoading}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Cache-fallback notice — shown when live XML-RPC balance fetch failed */}
      {data?.fromCache && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl border border-amber-500/25 bg-amber-500/8 text-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-semibold">Limited mode — live balance fetch unavailable</span>
            <p className="text-xs mt-0.5 opacity-75">
              Account list is sourced from cached data. Balance figures may show as zero.
              This usually resolves on its own — try <strong>refreshing the page</strong>. If it persists, verify the XML-RPC API Password in <strong>Settings → Sippy Connection</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Alert Banner */}
      {(criticalCount > 0 || warningCount > 0) && (
        <div className={cn(
          "flex items-start gap-3 p-4 rounded-xl border text-sm",
          criticalCount > 0
            ? "bg-rose-500/8 border-rose-500/25 text-rose-300"
            : "bg-amber-500/8 border-amber-500/25 text-amber-300"
        )}>
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-semibold">
              {criticalCount > 0
                ? `${criticalCount} account${criticalCount > 1 ? "s" : ""} at zero balance — calls may be failing`
                : `${warningCount} account${warningCount > 1 ? "s" : ""} below alert threshold`}
            </span>
            <p className="text-xs mt-0.5 opacity-75">Top-up immediately to restore service continuity.</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Fetching live account details from Sippy…</span>
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-rose-500/25 bg-rose-500/8 text-rose-300 text-sm">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          <span>{(error as any)?.message ?? "Failed to load balance data."}</span>
        </div>
      )}

      {/* No accounts */}
      {!isLoading && !error && accounts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Wallet className="w-10 h-10 opacity-20" />
          <p className="text-sm">No accounts found. Check your Sippy connection in Settings.</p>
        </div>
      )}

      {/* Account Cards Grid */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((a) => (
            <AccountCard key={a.iAccount} account={a} />
          ))}
        </div>
      )}

      {/* Legend */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground/60 pt-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-1.5 rounded-full bg-emerald-500" /> Healthy — above threshold
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-1.5 rounded-full bg-amber-500" /> Warning — at or below threshold
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-1.5 rounded-full bg-rose-500" /> Critical — balance ≤ 0
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-0.5 h-3 rounded-full bg-amber-400" /> Threshold marker
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" /> Refreshes every 2 minutes automatically
          </div>
        </div>
      )}
    </div>
  );
}
