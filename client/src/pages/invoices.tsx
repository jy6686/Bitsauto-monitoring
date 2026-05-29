import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileText, Play, Eye, CheckCircle, AlertTriangle, DollarSign, Hash,
  RefreshCw, Calendar, User,
} from "lucide-react";

interface Invoice {
  id:              number;
  invoiceNumber:   string;
  iTariff?:        string;
  customerName?:   string;
  periodStart?:    string;
  periodEnd?:      string;
  totalReproduced?: number;
  totalActual?:    number;
  totalDelta?:     number;
  lineCount?:      number;
  status:          string;
  generatedAt?:    string;
  approvedAt?:     string;
  sentAt?:         string;
  notes?:          string;
  htmlContent?:    string;
  createdAt:       string;
}

interface SippyAccount {
  iAccount:     number;
  username:     string;
  balance:      number;
  blocked:      boolean;
  cached:       boolean;
  companyName:  string | null;
  billingCycle: string | null;
  displayName:  string;
}

type BillingCycleMode = "custom" | "weekly" | "monthly";

interface FormState {
  iAccount:     string;
  iTariff:      string;
  customerName: string;
  periodStart:  string;
  periodEnd:    string;
  notes:        string;
  billingCycle: BillingCycleMode;
}

function toISO(d: Date) { return d.toISOString().slice(0, 10); }

function computeBillingPeriod(cycle: "weekly" | "monthly"): { start: string; end: string; label: string } {
  const now = new Date();
  if (cycle === "weekly") {
    const dow       = now.getDay();
    const fromMon   = dow === 0 ? 6 : dow - 1;
    const thisMon   = new Date(now); thisMon.setDate(now.getDate() - fromMon); thisMon.setHours(0,0,0,0);
    const lastMon   = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
    const lastSun   = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1);
    const fmt       = (d: Date) => d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" });
    const fmtY      = (d: Date) => d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric" });
    return { start: toISO(lastMon), end: toISO(lastSun), label: `${fmt(lastMon)} – ${fmtY(lastSun)} (last week)` };
  } else {
    const y  = now.getFullYear();
    const m  = now.getMonth();
    const s  = new Date(y, m - 1, 1);
    const e  = new Date(y, m, 0);
    return { start: toISO(s), end: toISO(e), label: s.toLocaleDateString("en-US", { month:"long", year:"numeric" }) };
  }
}

function cycleBadge(cycle: string | null) {
  if (!cycle) return null;
  const label: Record<string, string> = {
    weekly_cutoff: "Weekly", monthly: "Monthly", bi_weekly: "Bi-weekly", daily: "Daily",
  };
  return label[cycle] ?? cycle;
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    draft:    "bg-slate-500/15 text-slate-400 border-slate-500/30",
    review:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
    approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    sent:     "bg-green-500/15 text-green-400 border-green-500/30",
    void:     "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${cfg[status] ?? cfg.draft}`}>
      {status}
    </Badge>
  );
}

const EMPTY_FORM: FormState = {
  iAccount: "", iTariff: "", customerName: "",
  periodStart: "", periodEnd: "", notes: "",
  billingCycle: "custom",
};

export default function InvoicesPage() {
  const { toast }        = useToast();
  const queryClient      = useQueryClient();

  const [showGenerate, setShowGenerate] = useState(false);
  const [previewId,    setPreviewId]    = useState<number | null>(null);
  const [approveId,    setApproveId]    = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [form,         setForm]         = useState<FormState>(EMPTY_FORM);
  const [fetchingTariff, setFetchingTariff] = useState(false);
  const [tariffError,    setTariffError]    = useState<string | null>(null);

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: SippyAccount[]; error?: string }>({
    queryKey: ["/api/invoices/sippy-accounts"],
    queryFn: () => apiRequest("GET", "/api/invoices/sippy-accounts").then(r => r.json()),
    staleTime: 60_000,
  });
  const accounts = accountsData?.accounts ?? [];

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", filterStatus],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterStatus !== "all") p.set("status", filterStatus);
      return apiRequest("GET", `/api/invoices?${p}`).then(r => r.json());
    },
  });

  const { data: preview } = useQuery<Invoice>({
    queryKey: ["/api/invoices", previewId],
    queryFn: () => apiRequest("GET", `/api/invoices/${previewId}`).then(r => r.json()),
    enabled: previewId != null,
  });

  const generateMutation = useMutation({
    mutationFn: (data: FormState) =>
      apiRequest("POST", "/api/invoices/generate", {
        iTariff:     data.iTariff,
        customerName: data.customerName,
        periodStart:  data.periodStart,
        periodEnd:    data.periodEnd,
        notes:        data.notes,
      }).then(r => r.json()),
    onSuccess: (data: { invoice: Invoice; lineCount: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setShowGenerate(false);
      setForm(EMPTY_FORM);
      setPreviewId(data.invoice.id);
      toast({ title: `Invoice ${data.invoice.invoiceNumber} generated (DRAFT)`, description: `${data.lineCount} line items from locked snapshots.` });
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/invoices/${id}/approve`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setApproveId(null);
      toast({ title: "Invoice approved" });
    },
    onError: (err: any) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });

  async function onAccountSelect(iAccountStr: string) {
    const acct = accounts.find(a => String(a.iAccount) === iAccountStr);
    if (!acct) return;
    setForm(f => ({ ...f, iAccount: iAccountStr, customerName: acct.displayName, iTariff: "" }));
    setTariffError(null);
    setFetchingTariff(true);
    try {
      const info = await apiRequest("GET", `/api/sippy/accounts/${acct.iAccount}/info`).then(r => r.json());
      if (info.iTariff) {
        setForm(f => ({ ...f, iTariff: String(info.iTariff) }));
      } else {
        setTariffError("No tariff assigned to this account. Enter tariff ID manually.");
      }
    } catch {
      setTariffError("Could not fetch account tariff — enter ID manually.");
    } finally {
      setFetchingTariff(false);
    }

    if (acct.billingCycle && acct.billingCycle !== "custom") {
      const cycle = acct.billingCycle.startsWith("monthly") ? "monthly" : "weekly";
      const { start, end } = computeBillingPeriod(cycle);
      setForm(f => ({ ...f, billingCycle: cycle as BillingCycleMode, periodStart: start, periodEnd: end }));
    }
  }

  function onBillingCycleChange(cycle: BillingCycleMode) {
    if (cycle === "custom") {
      setForm(f => ({ ...f, billingCycle: "custom", periodStart: "", periodEnd: "" }));
    } else {
      const { start, end } = computeBillingPeriod(cycle);
      setForm(f => ({ ...f, billingCycle: cycle, periodStart: start, periodEnd: end }));
    }
  }

  const periodLabel = form.billingCycle !== "custom" && form.periodStart
    ? computeBillingPeriod(form.billingCycle as "weekly" | "monthly").label
    : null;

  const stats = {
    total:      invoices.length,
    draft:      invoices.filter(i => i.status === "draft").length,
    approved:   invoices.filter(i => i.status === "approved").length,
    totalValue: invoices.reduce((s, i) => s + (i.totalReproduced ?? 0), 0),
  };

  const canGenerate = !generateMutation.isPending && !!form.iAccount && !!form.iTariff && !!form.periodStart && !!form.periodEnd;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Invoices
          </h1>
          <p className="text-muted-foreground mt-1">
            Invoice engine sourced exclusively from immutable rating snapshots. Draft → Review → Approve → Send.
          </p>
        </div>
        <Button data-testid="button-generate-invoice" onClick={() => { setForm(EMPTY_FORM); setTariffError(null); setShowGenerate(true); }}>
          <Play className="h-4 w-4 mr-2" />Generate Invoice
        </Button>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-400">Draft Mode — Finance Review Required</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            All invoices start as DRAFT. Finance approval is required before sending.
            Invoices source exclusively from locked immutable snapshots.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Invoices", value: stats.total,    icon: <Hash className="h-4 w-4 text-blue-400" /> },
          { label: "Draft",          value: stats.draft,    icon: <FileText className="h-4 w-4 text-slate-400" /> },
          { label: "Approved",       value: stats.approved, icon: <CheckCircle className="h-4 w-4 text-emerald-400" /> },
          { label: "Total Value",    value: `$${stats.totalValue.toFixed(2)}`, icon: <DollarSign className="h-4 w-4 text-slate-400" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                {s.icon}
              </div>
              <p className="text-2xl font-bold mt-1 font-mono">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Invoice list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Invoice Register</CardTitle>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="select-filter-status" className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all","draft","review","approved","sent","void"].map(s => (
                  <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CardDescription className="text-xs">{invoices.length} invoice(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No invoices yet. Generate one from locked rating snapshots.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(inv => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell className="font-mono text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-sm">{inv.customerName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {inv.periodStart ?? "—"} → {inv.periodEnd ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{inv.lineCount?.toLocaleString() ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">
                        ${(inv.totalReproduced ?? 0).toFixed(4)}
                      </TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            data-testid={`button-view-${inv.id}`}
                            variant="ghost" size="sm"
                            onClick={() => setPreviewId(inv.id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {(inv.status === "draft" || inv.status === "review") && (
                            <Button
                              data-testid={`button-approve-${inv.id}`}
                              variant="ghost" size="sm"
                              onClick={() => setApproveId(inv.id)}
                            >
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate dialog */}
      <Dialog open={showGenerate} onOpenChange={o => { if (!o) { setShowGenerate(false); setTariffError(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate Invoice</DialogTitle>
            <DialogDescription>
              Creates a DRAFT invoice from locked immutable rating snapshots. Sourced by client account, never live tariffs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">

            {/* Client Account selector */}
            <div>
              <Label className="text-xs mb-1.5 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Client Account
              </Label>
              {accountsData?.error && (
                <p className="text-xs text-amber-400 mb-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {accountsData.error}
                </p>
              )}
              <Select
                value={form.iAccount}
                onValueChange={onAccountSelect}
                disabled={accountsLoading}
              >
                <SelectTrigger data-testid="select-inv-account">
                  <SelectValue placeholder={accountsLoading ? "Loading accounts…" : "Select client account"} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem key={a.iAccount} value={String(a.iAccount)}>
                      <span className="flex items-center gap-2">
                        {a.displayName}
                        {a.billingCycle && (
                          <span className="text-xs text-muted-foreground">({cycleBadge(a.billingCycle)})</span>
                        )}
                        {a.blocked && <span className="text-xs text-red-400">[blocked]</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Tariff status beneath account selector */}
              {fetchingTariff && (
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" /> Fetching assigned tariff from Sippy…
                </p>
              )}
              {!fetchingTariff && form.iTariff && (
                <p className="text-xs text-emerald-400 mt-1.5">✓ Tariff ID {form.iTariff} assigned</p>
              )}
              {!fetchingTariff && tariffError && (
                <p className="text-xs text-amber-400 mt-1.5">⚠ {tariffError}</p>
              )}
            </div>

            {/* Customer Name (editable) */}
            <div>
              <Label className="text-xs mb-1.5 block">Customer Name</Label>
              <Input
                data-testid="input-customer-name"
                value={form.customerName}
                onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                placeholder="Auto-filled from account selection"
              />
            </div>

            {/* Tariff ID (manual override when auto-fetch fails) */}
            {tariffError && (
              <div>
                <Label className="text-xs mb-1.5 block">Tariff ID (manual)</Label>
                <Input
                  data-testid="input-tariff-id"
                  value={form.iTariff}
                  onChange={e => setForm(f => ({ ...f, iTariff: e.target.value }))}
                  placeholder="Enter Sippy tariff ID"
                />
              </div>
            )}

            {/* Billing Cycle selector */}
            <div>
              <Label className="text-xs mb-2 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Billing Cycle
              </Label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { value: "custom",  label: "Custom" },
                  { value: "weekly",  label: "Weekly (Mon–Sun)" },
                  { value: "monthly", label: "Monthly" },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`button-cycle-${opt.value}`}
                    onClick={() => onBillingCycleChange(opt.value)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors
                      ${form.billingCycle === opt.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {periodLabel && (
                <div className="mt-2 px-3 py-2 rounded-md bg-cyan-500/10 border border-cyan-500/20">
                  <p className="text-xs text-cyan-400 font-medium">{periodLabel}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{form.periodStart} → {form.periodEnd}</p>
                </div>
              )}
            </div>

            {/* Period dates — shown always; read-only when auto-cycle */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Period Start</Label>
                <Input
                  data-testid="input-period-start"
                  type="date"
                  value={form.periodStart}
                  onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))}
                  readOnly={form.billingCycle !== "custom"}
                  className={form.billingCycle !== "custom" ? "opacity-60 cursor-default" : ""}
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Period End</Label>
                <Input
                  data-testid="input-period-end"
                  type="date"
                  value={form.periodEnd}
                  onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))}
                  readOnly={form.billingCycle !== "custom"}
                  className={form.billingCycle !== "custom" ? "opacity-60 cursor-default" : ""}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs mb-1.5 block">Notes (optional)</Label>
              <Input
                data-testid="input-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Payment terms, references…"
              />
            </div>

            {/* Generate button */}
            <Button
              data-testid="button-confirm-generate"
              className="w-full"
              onClick={() => generateMutation.mutate(form)}
              disabled={!canGenerate}
            >
              {generateMutation.isPending
                ? "Generating…"
                : !form.iAccount
                  ? "Select a client account"
                  : !form.iTariff
                    ? fetchingTariff ? "Fetching tariff…" : "Tariff ID required"
                    : !form.periodStart || !form.periodEnd
                      ? "Select billing period"
                      : "Generate Draft Invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewId != null} onOpenChange={open => !open && setPreviewId(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{preview?.invoiceNumber ?? "Invoice"}</DialogTitle>
            {preview && <StatusBadge status={preview.status} />}
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded border border-border">
            {preview?.htmlContent ? (
              <iframe
                data-testid="iframe-invoice-preview"
                srcDoc={preview.htmlContent}
                className="w-full min-h-[600px]"
                title="Invoice Preview"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="text-center py-10 text-muted-foreground">Loading invoice…</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Approve confirm */}
      <AlertDialog open={approveId != null} onOpenChange={open => !open && setApproveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks the invoice as approved. It will not be sent automatically — you will need to trigger delivery separately.
              Approved invoices cannot be reverted to draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-approve"
              onClick={() => approveId && approveMutation.mutate(approveId)}
            >
              Approve Invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
