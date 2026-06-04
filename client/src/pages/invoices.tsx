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
  RefreshCw, Calendar, User, Zap, CheckCheck, XCircle, Lock, Layers,
  Send, Mail, MailCheck, MailX, X, Clock, History,
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

interface SippyTariff {
  iTariff:   number;
  name:      string;
  currency:  string;
}

type BillingCycleMode = "custom" | "weekly" | "monthly";

interface FormState {
  iAccount:       string;
  iTariff:        string;
  customerName:   string;
  periodStart:    string;
  periodEnd:      string;
  notes:          string;
  billingCycle:   BillingCycleMode;
  clientTimezone: string | null;
}

interface DmrGateError {
  missingDates:  string[];
  criticalDates: string[];
  detail:        string;
}

interface DmrAutoResult {
  date:      string;
  generated: number;
  verified:  number;
  error?:    string;
}

function toISO(d: Date) { return d.toISOString().slice(0, 10); }

function computeBillingPeriod(cycle: "weekly" | "monthly", timezone?: string | null): { start: string; end: string; label: string } {
  // Use client timezone if provided, otherwise fall back to browser local time
  const tz = timezone || undefined;
  const toTzDate = (d: Date) => {
    if (!tz) return d;
    // Project wall-clock date in target timezone back to a plain Date
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit" }).format(d).split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  };
  const now    = toTzDate(new Date());
  const tzInfo = tz ? ` (${tz.replace("_", " ")})` : "";
  if (cycle === "weekly") {
    const dow     = now.getDay();
    const fromMon = dow === 0 ? 6 : dow - 1;
    const thisMon = new Date(now); thisMon.setDate(now.getDate() - fromMon);
    const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
    const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1);
    const fmt  = (d: Date) => d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" });
    const fmtY = (d: Date) => d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric" });
    return { start: toISO(lastMon), end: toISO(lastSun), label: `${fmt(lastMon)} – ${fmtY(lastSun)} (last week)${tzInfo}` };
  } else {
    const y = now.getFullYear();
    const m = now.getMonth();
    const s = new Date(y, m - 1, 1);
    const e = new Date(y, m, 0);
    return { start: toISO(s), end: toISO(e), label: `${s.toLocaleDateString("en-US", { month:"long", year:"numeric" })}${tzInfo}` };
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
  billingCycle: "custom", clientTimezone: null,
};

interface SendForm {
  recipientInput: string;  // raw input for adding recipients
  recipients:     string[];
  ccInput:        string;
  cc:             string[];
  subject:        string;
  body:           string;
}

interface EmailDelivery {
  id:           number;
  invoiceId:    number;
  recipients:   string;
  ccAddresses:  string;
  subject:      string;
  sentBy:       string | null;
  status:       string;
  errorMessage: string | null;
  sentAt:       string | null;
  createdAt:    string;
}

const EMPTY_SEND: SendForm = {
  recipientInput: '',
  recipients:     [],
  ccInput:        '',
  cc:             [],
  subject:        '',
  body:           '',
};

export default function InvoicesPage() {
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const [showGenerate,   setShowGenerate]   = useState(false);
  const [previewId,      setPreviewId]      = useState<number | null>(null);
  const [previewTab,     setPreviewTab]     = useState<'preview' | 'history'>('preview');
  const [approveId,      setApproveId]      = useState<number | null>(null);
  const [sendId,         setSendId]         = useState<number | null>(null);
  const [sendForm,       setSendForm]       = useState<SendForm>(EMPTY_SEND);
  const [filterStatus,   setFilterStatus]   = useState("all");
  const [form,           setForm]           = useState<FormState>(EMPTY_FORM);
  const [fetchingTariff, setFetchingTariff] = useState(false);
  const [autoTariffName, setAutoTariffName] = useState<string | null>(null);
  const [dmrGateError,      setDmrGateError]      = useState<DmrGateError | null>(null);
  const [dmrAutoResults,    setDmrAutoResults]    = useState<DmrAutoResult[] | null>(null);
  const [dmrAutoRunning,    setDmrAutoRunning]    = useState(false);
  const [snapshotGateError, setSnapshotGateError] = useState<string | null>(null);
  const [lockBatchRunning,  setLockBatchRunning]  = useState(false);
  const [lockBatchResult,   setLockBatchResult]   = useState<{ created: number; skipped: number } | null>(null);
  const [seedJobPhase,      setSeedJobPhase]      = useState<string>('');

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ["/api/invoices/sippy-accounts"],
    queryFn: () => apiRequest("GET", "/api/invoices/sippy-accounts").then(r => r.json()),
    staleTime: 60_000,
  });
  const accounts = accountsData?.accounts ?? [];

  const { data: tariffsRaw = [] } = useQuery<SippyTariff[]>({
    queryKey: ["/api/sippy/tariffs"],
    queryFn: () => apiRequest("GET", "/api/sippy/tariffs").then(r => r.json()),
    staleTime: 120_000,
    enabled: showGenerate,
  });
  const tariffs: SippyTariff[] = Array.isArray(tariffsRaw) ? tariffsRaw : [];

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
        iTariff:      data.iTariff,
        customerName: data.customerName,
        periodStart:  data.periodStart,
        periodEnd:    data.periodEnd,
        notes:        data.notes,
      }).then(async r => {
        if (!r.ok) {
          const body = await r.json();
          throw Object.assign(new Error(body.error ?? "Generation failed"), body);
        }
        return r.json();
      }),
    onSuccess: (data: { invoice: Invoice; lineCount: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setDmrGateError(null);
      setDmrAutoResults(null);
      setShowGenerate(false);
      setForm(EMPTY_FORM);
      setAutoTariffName(null);
      setPreviewId(data.invoice.id);
      toast({ title: `Invoice ${data.invoice.invoiceNumber} generated (DRAFT)`, description: `${data.lineCount} line items from locked snapshots.` });
    },
    onError: (err: any) => {
      if (err.missingDates || err.criticalDates) {
        setDmrGateError({
          missingDates:  err.missingDates  ?? [],
          criticalDates: err.criticalDates ?? [],
          detail:        err.detail        ?? err.message,
        });
      } else if (err.message?.includes("No locked snapshots")) {
        setSnapshotGateError(err.message);
        // intentionally keep lockBatchResult so context (skipped count) stays visible
      } else {
        toast({ title: "Generation failed", description: err.message, variant: "destructive" });
      }
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

  const sendMutation = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: SendForm }) => {
      const res = await apiRequest("POST", `/api/invoices/${id}/send`, {
        recipients: form.recipients,
        cc:         form.cc,
        subject:    form.subject,
        body:       form.body,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Send failed");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", sendId, "deliveries"] });
      setSendId(null);
      setSendForm(EMPTY_SEND);
      toast({ title: "Invoice sent successfully", description: "Email delivered and delivery logged." });
    },
    onError: (err: any) => {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: deliveries = [], isLoading: deliveriesLoading } = useQuery<EmailDelivery[]>({
    queryKey: ["/api/invoices", previewId, "deliveries"],
    queryFn:  () => apiRequest("GET", `/api/invoices/${previewId}/deliveries`).then(r => r.json()),
    enabled:  previewId != null && previewTab === 'history',
  });

  async function openSendDialog(inv: Invoice) {
    const fmtPeriodDate = (s?: string) => {
      if (!s) return '';
      const [y, m, d] = s.split('-');
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${d}-${MONTHS[+m - 1]}-${y}`;
    };
    const todayStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
    const custUpper = (inv.customerName ?? '').toUpperCase();
    const defaultSubject = `ICHIBAAN LOGIC INVOICE || ${custUpper} || ${todayStr}`;
    const periodLine = inv.periodStart
      ? `${fmtPeriodDate(inv.periodStart)} to ${fmtPeriodDate(inv.periodEnd ?? inv.periodStart)}`
      : '';
    const defaultBody = `Dear Client,\n\nWe are pleased to share the invoice for the period ${periodLine}.\n\nIt is requested to please acknowledge the invoice and make sure that payment will be according to agreed term.\n\nFor dispute related questions please email to dispute@ichibaanlogic.com.\n\n\nThanks and Regards,\n\nIchibaan Billing Department\nInternational Voice Business\nIchibaan Logic Private Limited\n(formerly Bhaoo Private Limited)\n\nEmail   : billing@ichibaanlogic.com\nURL     : www.ichibaanlogic.com`;

    // Prefill with empty — open dialog immediately
    setSendId(inv.id);
    setSendForm({
      subject:        defaultSubject,
      body:           defaultBody,
      recipients:     [],
      cc:             [],
      recipientInput: '',
      ccInput:        '',
    });

    // Fetch known email in background and prefill recipients if found
    try {
      const res  = await apiRequest("GET", `/api/invoices/${inv.id}/customer-email`);
      const data = await res.json();
      if (Array.isArray(data.emails) && data.emails.length > 0) {
        setSendForm(f => ({ ...f, recipients: data.emails }));
      }
    } catch { /* best-effort */ }
  }

  function addTag(field: 'recipients' | 'cc', raw: string) {
    const emails = raw.split(/[,;\s]+/).map(e => e.trim()).filter(e => e.includes('@'));
    if (emails.length === 0) return;
    setSendForm(f => ({
      ...f,
      [field]:               [...new Set([...f[field], ...emails])],
      [`${field}Input` as any]: '',
    }));
  }

  function removeTag(field: 'recipients' | 'cc', email: string) {
    setSendForm(f => ({ ...f, [field]: f[field].filter(e => e !== email) }));
  }

  async function onAccountSelect(iAccountStr: string) {
    const acct = accounts.find(a => String(a.iAccount) === iAccountStr);
    if (!acct) return;
    setForm(f => ({ ...f, iAccount: iAccountStr, customerName: acct.displayName, iTariff: "", clientTimezone: null }));
    setAutoTariffName(null);
    setDmrGateError(null);
    setDmrAutoResults(null);
    setSnapshotGateError(null);
    setLockBatchResult(null);
    setFetchingTariff(true);

    // Fetch client timezone from company record (best-effort)
    let clientTimezone: string | null = null;
    try {
      const companiesRes: any = await apiRequest("GET", "/api/companies").then(r => r.json());
      const companies: any[] = companiesRes.companies ?? (Array.isArray(companiesRes) ? companiesRes : []);
      const company = companies.find((c: any) =>
        String(c.sippyAccountId) === iAccountStr ||
        c.name?.toLowerCase() === acct.displayName?.toLowerCase()
      );
      if (company?.clientTimezone) clientTimezone = company.clientTimezone;
    } catch { /* optional */ }

    try {
      const info = await apiRequest("GET", `/api/sippy/accounts/${acct.iAccount}/info`).then(r => r.json());
      const tariffId = info.iTariff ?? info.i_tariff;
      if (tariffId && Number(tariffId) > 0) {
        setForm(f => ({ ...f, iTariff: String(tariffId), clientTimezone }));
        const matched = tariffs.find(t => t.iTariff === Number(tariffId));
        setAutoTariffName(matched?.name ?? null);
      } else {
        setForm(f => ({ ...f, clientTimezone }));
      }
      // If not found via getAccountInfo, leave iTariff empty — user picks from dropdown
    } catch {
      setForm(f => ({ ...f, clientTimezone }));
    } finally {
      setFetchingTariff(false);
    }

    if (acct.billingCycle && acct.billingCycle !== "custom") {
      const cycle = acct.billingCycle.startsWith("monthly") ? "monthly" : "weekly";
      const { start, end } = computeBillingPeriod(cycle, clientTimezone);
      setForm(f => ({ ...f, billingCycle: cycle as BillingCycleMode, periodStart: start, periodEnd: end }));
    }
  }

  function onTariffSelect(val: string) {
    setForm(f => ({ ...f, iTariff: val }));
    const matched = tariffs.find(t => String(t.iTariff) === val);
    setAutoTariffName(matched?.name ?? null);
    setDmrGateError(null);
    setDmrAutoResults(null);
    setSnapshotGateError(null);
    setLockBatchResult(null);
  }

  function onBillingCycleChange(cycle: BillingCycleMode) {
    if (cycle === "custom") {
      setForm(f => ({ ...f, billingCycle: "custom", periodStart: "", periodEnd: "" }));
    } else {
      const { start, end } = computeBillingPeriod(cycle, form.clientTimezone);
      setForm(f => ({ ...f, billingCycle: cycle, periodStart: start, periodEnd: end }));
    }
    setDmrGateError(null);
    setDmrAutoResults(null);
    setSnapshotGateError(null);
    setLockBatchResult(null);
  }

  async function handleAutoGenerateDmr() {
    if (!form.periodStart || !form.periodEnd) return;
    setDmrAutoRunning(true);
    setDmrAutoResults(null);
    try {
      const r    = await apiRequest("POST", "/api/dmr/auto-verify-period", { from: form.periodStart, to: form.periodEnd });
      const body = await r.json();
      if (!r.ok) {
        toast({ title: "DMR auto-generate failed", description: body.error, variant: "destructive" });
        return;
      }
      setDmrAutoResults(body.processed ?? []);
      if (body.periodNowVerified || body.alreadyVerified) {
        setDmrGateError(null);
        toast({ title: "DMR verified for all dates", description: "You can now generate the invoice." });
      } else {
        toast({ title: "DMR partially verified", description: `${body.remainingMissing?.length ?? 0} date(s) still pending.`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "DMR auto-generate error", description: err.message, variant: "destructive" });
    } finally {
      setDmrAutoRunning(false);
    }
  }

  async function handleRunLockBatch() {
    setLockBatchRunning(true);
    setLockBatchResult(null);
    setSeedJobPhase('Starting…');
    try {
      if (!form.iAccount || !form.iTariff || !form.periodStart) {
        throw new Error("Account, tariff and period start are required");
      }

      // POST returns immediately with {jobId} — no 504 timeout possible
      const res  = await apiRequest("POST", "/api/rating-snapshots/seed-from-portal", {
        iAccount:    form.iAccount,
        iTariff:     form.iTariff,
        periodStart: form.periodStart,
        periodEnd:   form.periodEnd || form.periodStart,
        limit:       100000,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Snapshot seeding failed");

      const { jobId } = body;
      if (!jobId) throw new Error("Server did not return a job ID");

      // Poll for completion every 2 seconds
      await new Promise<void>((resolve, reject) => {
        const INTERVAL = 2000;
        const TIMEOUT  = 15 * 60 * 1000; // 15 min absolute cap
        const started  = Date.now();

        const tick = async () => {
          try {
            const pr   = await fetch(`/api/rating-snapshots/seed-job/${jobId}`);
            const job  = await pr.json();
            setSeedJobPhase(job.phase ?? '');

            if (job.status === 'done') {
              const created = job.created ?? 0;
              const skipped = job.skipped ?? 0;
              const total   = job.total   ?? 0;
              setLockBatchResult({ created, skipped });

              if (created > 0) {
                setSnapshotGateError(null);
                toast({ title: "Snapshots locked", description: `${created} CDR snapshot(s) seeded. Click Generate to continue.` });
              } else if (skipped > 0) {
                setSnapshotGateError(null);
                toast({ title: `${skipped} snapshot(s) already exist`, description: "Click Generate Draft Invoice to proceed." });
              } else {
                toast({
                  title: "No CDRs from Admin API",
                  description: total === 0
                    ? (job.phase && job.phase.length > 20 ? job.phase : "Admin API returned 0 CDRs for this account and billing period. Verify the iAccount ID and XML-RPC credentials in Settings → Sippy Connection.")
                    : `${total} CDRs fetched but none were new.`,
                  variant: "destructive",
                });
              }
              return resolve();
            }

            if (job.status === 'error') return reject(new Error(job.error ?? 'Seeding failed'));
            if (Date.now() - started > TIMEOUT) return reject(new Error('Seeding timed out after 15 minutes'));

            setTimeout(tick, INTERVAL);
          } catch (e: any) {
            reject(e);
          }
        };
        setTimeout(tick, INTERVAL);
      });
    } catch (err: any) {
      toast({ title: "Snapshot seeding failed", description: err.message, variant: "destructive" });
    } finally {
      setLockBatchRunning(false);
      setSeedJobPhase('');
    }
  }

  function resetModal() {
    setShowGenerate(false);
    setForm(EMPTY_FORM);
    setAutoTariffName(null);
    setDmrGateError(null);
    setDmrAutoResults(null);
    setSnapshotGateError(null);
    setLockBatchResult(null);
    setFetchingTariff(false);
  }

  const periodLabel = form.billingCycle !== "custom" && form.periodStart
    ? computeBillingPeriod(form.billingCycle as "weekly" | "monthly", form.clientTimezone).label
    : null;

  const selectedTariff = tariffs.find(t => String(t.iTariff) === form.iTariff);

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
        <Button data-testid="button-generate-invoice" onClick={() => { setForm(EMPTY_FORM); setAutoTariffName(null); setDmrGateError(null); setDmrAutoResults(null); setShowGenerate(true); }}>
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
                      <TableCell className="font-mono text-sm">${(inv.totalReproduced ?? 0).toFixed(4)}</TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button data-testid={`button-view-${inv.id}`} variant="ghost" size="sm" onClick={() => setPreviewId(inv.id)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {(inv.status === "draft" || inv.status === "review") && (
                            <Button data-testid={`button-approve-${inv.id}`} variant="ghost" size="sm" onClick={() => setApproveId(inv.id)}>
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                            </Button>
                          )}
                          {(inv.status === "approved" || inv.status === "sent") && (
                            <Button
                              data-testid={`button-send-${inv.id}`}
                              variant="ghost"
                              size="sm"
                              title="Send invoice via email"
                              onClick={() => openSendDialog(inv)}
                            >
                              <Send className="h-3.5 w-3.5 text-blue-400" />
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

      {/* ── Generate dialog ── */}
      <Dialog open={showGenerate} onOpenChange={o => { if (!o) resetModal(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Invoice</DialogTitle>
            <DialogDescription>
              Creates a DRAFT invoice from locked immutable rating snapshots. Sourced by client account, never live tariffs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">

            {/* ── Client Account ── */}
            <div>
              <Label className="text-xs mb-1.5 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Client Account
              </Label>
              <Select value={form.iAccount} onValueChange={onAccountSelect} disabled={accountsLoading}>
                <SelectTrigger data-testid="select-inv-account">
                  <SelectValue placeholder={accountsLoading ? "Loading accounts…" : "Select client account"} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem key={a.iAccount} value={String(a.iAccount)}>
                      <span className="flex items-center gap-2">
                        {a.displayName}
                        {a.billingCycle && <span className="text-xs text-muted-foreground">({cycleBadge(a.billingCycle)})</span>}
                        {a.blocked && <span className="text-xs text-red-400">[blocked]</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fetchingTariff && (
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" /> Looking up assigned tariff…
                </p>
              )}
            </div>

            {/* ── Customer Name ── */}
            <div>
              <Label className="text-xs mb-1.5 block">Customer Name</Label>
              <Input
                data-testid="input-customer-name"
                value={form.customerName}
                onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                placeholder="Auto-filled from account selection"
              />
            </div>

            {/* ── Tariff / Service Plan ── */}
            <div>
              <Label className="text-xs mb-1.5 block">Service Plan (Tariff)</Label>
              <Select
                value={form.iTariff}
                onValueChange={onTariffSelect}
                disabled={!form.iAccount || fetchingTariff || tariffs.length === 0}
              >
                <SelectTrigger data-testid="select-inv-tariff">
                  <SelectValue
                    placeholder={
                      !form.iAccount    ? "Select a client account first" :
                      fetchingTariff    ? "Fetching…" :
                      tariffs.length === 0 ? "Loading tariffs…" :
                      "Select service plan"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {tariffs
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(t => (
                      <SelectItem key={t.iTariff} value={String(t.iTariff)} data-testid={`tariff-option-${t.iTariff}`}>
                        <span className="flex items-center gap-2">
                          <span>{t.name}</span>
                          <span className="text-xs text-muted-foreground font-mono">({t.currency} · ID {t.iTariff})</span>
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>

              {/* Status line below tariff selector */}
              {form.iTariff && !fetchingTariff && (
                <p className="text-xs text-emerald-400 mt-1.5 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  {selectedTariff
                    ? `${selectedTariff.name} · ${selectedTariff.currency} · ID ${selectedTariff.iTariff}`
                    : `Tariff ID ${form.iTariff} selected`
                  }
                  {autoTariffName && form.iTariff && (
                    <span className="text-muted-foreground ml-1">(auto-matched from account)</span>
                  )}
                </p>
              )}
            </div>

            {/* ── Billing Cycle ── */}
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

            {/* ── Period dates ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Period Start</Label>
                <Input
                  data-testid="input-period-start"
                  type="date"
                  value={form.periodStart}
                  onChange={e => { setForm(f => ({ ...f, periodStart: e.target.value })); setDmrGateError(null); setDmrAutoResults(null); setSnapshotGateError(null); setLockBatchResult(null); }}
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
                  onChange={e => { setForm(f => ({ ...f, periodEnd: e.target.value })); setDmrGateError(null); setDmrAutoResults(null); setSnapshotGateError(null); setLockBatchResult(null); }}
                  readOnly={form.billingCycle !== "custom"}
                  className={form.billingCycle !== "custom" ? "opacity-60 cursor-default" : ""}
                />
              </div>
            </div>

            {/* ── Notes ── */}
            <div>
              <Label className="text-xs mb-1.5 block">Notes (optional)</Label>
              <Input
                data-testid="input-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Payment terms, references…"
              />
            </div>

            {/* ── Snapshot Gate Error block ── */}
            {snapshotGateError && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Lock className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-400">No Locked Snapshots — Pre-requisite Required</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Invoice generation requires immutable CDR rating snapshots to be crystallised first.
                      This is a two-step process: <span className="text-amber-300 font-medium">Rating Verification → Lock Batch</span>.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
                  <Layers className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400/70" />
                  <span>
                    Step 1 fetches billing CDRs via the <span className="text-amber-300 font-medium">Sippy Admin API (XML-RPC)</span> for tariff <span className="font-mono text-amber-300">ID {form.iTariff}</span> — never from live operational data.
                    Step 2 crystallises verified records into locked, immutable snapshots used for invoice line items.
                  </span>
                </div>
                {lockBatchResult && lockBatchResult.created === 0 && (
                  <div className="text-xs text-muted-foreground px-1">
                    <span className="text-amber-300 font-medium">0 new snapshots created</span>
                    {lockBatchResult.skipped > 0
                      ? ` — ${lockBatchResult.skipped} snapshot(s) already exist for this tariff.`
                      : " — Admin API returned 0 CDRs. Check the iAccount ID and XML-RPC credentials in Settings → Sippy Connection."}
                  </div>
                )}
                <Button
                  data-testid="button-run-lock-batch"
                  size="sm"
                  variant="outline"
                  className="w-full border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                  onClick={handleRunLockBatch}
                  disabled={lockBatchRunning}
                >
                  {lockBatchRunning
                    ? <><RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />{seedJobPhase || 'Starting…'}</>
                    : <><Zap className="h-3.5 w-3.5 mr-2" />Fetch via Admin API + Lock Batch</>
                  }
                </Button>
              </div>
            )}

            {/* ── Lock batch success ── */}
            {lockBatchResult && lockBatchResult.created > 0 && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/8 p-3 flex items-center gap-2">
                <CheckCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <p className="text-xs text-emerald-400 font-medium">
                  {lockBatchResult.created} CDR snapshot(s) locked.
                  {lockBatchResult.skipped > 0 && ` (${lockBatchResult.skipped} already existed)`}
                  {" "}Click <span className="font-semibold">Generate Draft Invoice</span> below.
                </p>
              </div>
            )}

            {/* ── DMR Gate Error block ── */}
            {dmrGateError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-400">DMR Governance Gate — Blocked</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      All days in the billing period must have verified Daily Metrics Reports before an invoice can be generated.
                    </p>
                  </div>
                </div>
                {dmrGateError.missingDates.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-red-300 mb-1.5">{dmrGateError.missingDates.length} date(s) missing verified DMR:</p>
                    <div className="flex flex-wrap gap-1">
                      {dmrGateError.missingDates.map(d => (
                        <span key={d} className="font-mono text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/20">{d}</span>
                      ))}
                    </div>
                  </div>
                )}
                {dmrGateError.criticalDates.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-amber-300 mb-1.5">{dmrGateError.criticalDates.length} date(s) have critical discrepancies — manual review needed:</p>
                    <div className="flex flex-wrap gap-1">
                      {dmrGateError.criticalDates.map(d => (
                        <span key={d} className="font-mono text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">{d}</span>
                      ))}
                    </div>
                  </div>
                )}
                {dmrGateError.missingDates.length > 0 && dmrGateError.criticalDates.length === 0 && (
                  <Button
                    data-testid="button-auto-dmr"
                    size="sm"
                    variant="outline"
                    className="w-full border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
                    onClick={handleAutoGenerateDmr}
                    disabled={dmrAutoRunning}
                  >
                    {dmrAutoRunning
                      ? <><RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />Generating DMR for {dmrGateError.missingDates.length} date(s)…</>
                      : <><Zap className="h-3.5 w-3.5 mr-2" />Auto-generate &amp; Verify DMR for all {dmrGateError.missingDates.length} date(s)</>
                    }
                  </Button>
                )}
              </div>
            )}

            {/* ── DMR Auto-generate results ── */}
            {dmrAutoResults && dmrAutoResults.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">DMR Generation Results</p>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {dmrAutoResults.map(r => (
                    <div key={r.date} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{r.date}</span>
                      {r.error
                        ? <span className="text-red-400 flex items-center gap-1"><XCircle className="h-3 w-3" />{r.error.slice(0, 50)}</span>
                        : <span className="text-emerald-400 flex items-center gap-1"><CheckCheck className="h-3 w-3" />{r.verified} row(s) verified</span>
                      }
                    </div>
                  ))}
                </div>
                {!dmrGateError && (
                  <p className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle className="h-3.5 w-3.5" /> All dates verified — period cleared. Click generate below.
                  </p>
                )}
              </div>
            )}

            {/* ── Generate button ── */}
            <Button
              data-testid="button-confirm-generate"
              className="w-full"
              onClick={() => generateMutation.mutate(form)}
              disabled={!canGenerate || dmrAutoRunning}
            >
              {generateMutation.isPending
                ? "Generating…"
                : !form.iAccount
                  ? "Select a client account"
                  : !form.iTariff
                    ? fetchingTariff ? "Fetching tariff…" : "Select a service plan"
                    : !form.periodStart || !form.periodEnd
                      ? "Select billing period"
                      : "Generate Draft Invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Preview dialog ── */}
      <Dialog open={previewId != null} onOpenChange={open => { if (!open) { setPreviewId(null); setPreviewTab('preview'); } }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-3 flex-wrap">
              <DialogTitle>{preview?.invoiceNumber ?? "Invoice"}</DialogTitle>
              {preview && <StatusBadge status={preview.status} />}
              {preview && (preview.status === 'approved' || preview.status === 'sent') && (
                <Button
                  data-testid="button-send-from-preview"
                  size="sm"
                  variant="outline"
                  className="ml-auto border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                  onClick={() => { setPreviewId(null); setPreviewTab('preview'); openSendDialog(preview); }}
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" /> Send Invoice
                </Button>
              )}
            </div>
          </DialogHeader>
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-border pb-2 -mt-1">
            <button
              type="button"
              data-testid="tab-preview-invoice"
              onClick={() => setPreviewTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${previewTab === 'preview' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
            <button
              type="button"
              data-testid="tab-delivery-history"
              onClick={() => setPreviewTab('history')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${previewTab === 'history' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <History className="h-3.5 w-3.5" /> Delivery History
            </button>
          </div>
          {previewTab === 'preview' ? (
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
          ) : (
            <div className="flex-1 overflow-auto">
              {deliveriesLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Loading history…</div>
              ) : deliveries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No delivery records yet for this invoice.</p>
                  <p className="text-xs mt-1">Use the <Send className="h-3 w-3 inline" /> Send button to deliver it.</p>
                </div>
              ) : (
                <div className="space-y-3 py-1">
                  {deliveries.map(d => {
                    let recipients: string[] = [];
                    let cc: string[] = [];
                    try { recipients = JSON.parse(d.recipients); } catch {}
                    try { cc = JSON.parse(d.ccAddresses); } catch {}
                    return (
                      <div key={d.id} className={`rounded-lg border p-4 ${d.status === 'sent' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {d.status === 'sent'
                              ? <MailCheck className="h-4 w-4 text-emerald-400" />
                              : <MailX className="h-4 w-4 text-red-400" />}
                            <span className={`text-xs font-medium ${d.status === 'sent' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {d.status === 'sent' ? 'Delivered' : 'Failed'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {d.sentAt ? new Date(d.sentAt).toLocaleString() : new Date(d.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <p className="text-sm font-medium mb-1 truncate">{d.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/60">To:</span>{" "}
                          {recipients.join(', ') || '—'}
                        </p>
                        {cc.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/60">CC:</span>{" "}
                            {cc.join(', ')}
                          </p>
                        )}
                        {d.sentBy && (
                          <p className="text-xs text-muted-foreground mt-1">
                            <span className="font-medium text-foreground/60">Sent by:</span> {d.sentBy}
                          </p>
                        )}
                        {d.status === 'failed' && d.errorMessage && (
                          <p className="text-xs text-red-400 mt-2 bg-red-500/10 rounded px-2 py-1">
                            {d.errorMessage}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Send Invoice compose dialog ── */}
      {(() => {
        const sendingInv = invoices.find(i => i.id === sendId);
        return (
          <Dialog open={sendId != null} onOpenChange={open => { if (!open) { setSendId(null); setSendForm(EMPTY_SEND); } }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Send className="h-4 w-4 text-blue-400" />
                  Send Invoice
                </DialogTitle>
                <DialogDescription>
                  {sendingInv
                    ? `Deliver ${sendingInv.invoiceNumber} to ${sendingInv.customerName ?? 'customer'} via email.`
                    : 'Compose and send invoice to customer.'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Recipients */}
                <div className="space-y-1.5">
                  <Label className="text-xs">To (recipients)</Label>
                  <div className="rounded-lg border border-border p-2 min-h-[42px] flex flex-wrap gap-1.5 focus-within:ring-2 focus-within:ring-primary/30">
                    {sendForm.recipients.map(r => (
                      <span key={r} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        {r}
                        <button type="button" data-testid={`remove-recipient-${r}`} onClick={() => removeTag('recipients', r)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      data-testid="input-recipient"
                      placeholder={sendForm.recipients.length === 0 ? "email@example.com (press Enter or comma)" : ""}
                      value={sendForm.recipientInput}
                      onChange={e => setSendForm(f => ({ ...f, recipientInput: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addTag('recipients', sendForm.recipientInput);
                        } else if (e.key === 'Backspace' && !sendForm.recipientInput && sendForm.recipients.length > 0) {
                          removeTag('recipients', sendForm.recipients[sendForm.recipients.length - 1]);
                        }
                      }}
                      onBlur={() => { if (sendForm.recipientInput) addTag('recipients', sendForm.recipientInput); }}
                      className="flex-1 min-w-[140px] bg-transparent text-sm focus:outline-none"
                    />
                  </div>
                </div>

                {/* CC */}
                <div className="space-y-1.5">
                  <Label className="text-xs">CC (optional)</Label>
                  <div className="rounded-lg border border-border p-2 min-h-[38px] flex flex-wrap gap-1.5 focus-within:ring-2 focus-within:ring-primary/30">
                    {sendForm.cc.map(c => (
                      <span key={c} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                        {c}
                        <button type="button" data-testid={`remove-cc-${c}`} onClick={() => removeTag('cc', c)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      data-testid="input-cc"
                      placeholder={sendForm.cc.length === 0 ? "cc@example.com" : ""}
                      value={sendForm.ccInput}
                      onChange={e => setSendForm(f => ({ ...f, ccInput: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addTag('cc', sendForm.ccInput);
                        } else if (e.key === 'Backspace' && !sendForm.ccInput && sendForm.cc.length > 0) {
                          removeTag('cc', sendForm.cc[sendForm.cc.length - 1]);
                        }
                      }}
                      onBlur={() => { if (sendForm.ccInput) addTag('cc', sendForm.ccInput); }}
                      className="flex-1 min-w-[140px] bg-transparent text-sm focus:outline-none"
                    />
                  </div>
                </div>

                {/* Subject */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Subject</Label>
                  <input
                    type="text"
                    data-testid="input-send-subject"
                    value={sendForm.subject}
                    onChange={e => setSendForm(f => ({ ...f, subject: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                {/* Body */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Message body</Label>
                  <textarea
                    data-testid="input-send-body"
                    rows={7}
                    value={sendForm.body}
                    onChange={e => setSendForm(f => ({ ...f, body: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Invoice HTML will be attached automatically as a file.</p>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <Button
                    data-testid="button-confirm-send"
                    className="flex-1"
                    disabled={sendMutation.isPending || sendForm.recipients.length === 0 || !sendForm.subject.trim()}
                    onClick={() => sendId && sendMutation.mutate({ id: sendId, form: sendForm })}
                  >
                    {sendMutation.isPending ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                    ) : (
                      <><Send className="h-4 w-4 mr-2" />Send Invoice</>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setSendId(null); setSendForm(EMPTY_SEND); }}
                    disabled={sendMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>

                {sendForm.recipients.length === 0 && (
                  <p className="text-xs text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Add at least one recipient email address.
                  </p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Approve confirm ── */}
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
            <AlertDialogAction data-testid="button-confirm-approve" onClick={() => approveId && approveMutation.mutate(approveId)}>
              Approve Invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
