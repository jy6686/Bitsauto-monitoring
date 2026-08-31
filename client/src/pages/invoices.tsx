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
  Send, Mail, MailCheck, MailX, X, Clock, History, FileSpreadsheet, FileDown, Flag,
} from "lucide-react";
import { exportToExcel } from "@/lib/export-excel";
import { toIanaTimeZone } from "@shared/timezone";

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
  /** @deprecated Phase 1 of retirement — still written, no longer read.
   *  The preview renders the canonical PDF; this frozen blob was built from
   *  reproducedCost while the invoice bills actualCost, and predated the
   *  destination catalogue, so it showed different destinations, different
   *  rates and a total 60x the customer's on the approval screen. */
  htmlContent?:    string;
  /** Certification state AT GENERATION TIME — provenance for the approver. */
  certificationStatus?: string;
  verificationRunId?:   number;
  overrideReason?:      string;
  overriddenBy?:        string;
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

interface BulkGenResult {
  iAccount: number;
  name:     string;
  period:   string;
  status:   'ok' | 'skipped' | 'error';
  detail:   string;
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
  // Resolve to an identifier Intl accepts. Company records store legacy
  // dropdown LABELS ("GMT+00:00 | UTC"), and passing one straight to
  // Intl.DateTimeFormat threw RangeError which escaped to the error boundary
  // and took this entire page down.
  const tz = timezone ? toIanaTimeZone(timezone) : undefined;
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

// Bulk generation: derive the invoice period from the client's own billing
// cycle. Weekly/daily cycles bill the last full Mon–Sun week; bi-weekly the
// last two full weeks; monthly (and unknown cycles) the last full calendar
// month. Each client in a bulk batch gets ITS OWN period — never one shared
// range forced across mixed cycles.
function cyclePeriod(cycle: string | null, timezone?: string | null): { start: string; end: string; label: string } {
  if (cycle === "weekly_cutoff" || cycle === "weekly" || cycle === "daily") {
    return computeBillingPeriod("weekly", timezone);
  }
  if (cycle === "bi_weekly") {
    const wk = computeBillingPeriod("weekly", timezone);
    const s  = new Date(wk.start + "T00:00:00"); s.setDate(s.getDate() - 7);
    const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return { start: toISO(s), end: wk.end, label: `${fmt(s)} – ${fmt(new Date(wk.end + "T00:00:00"))} (last 2 weeks)` };
  }
  return computeBillingPeriod("monthly", timezone);
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

  // Bulk approve / send — continue-on-error on the server; the summary toast
  // reports counts and the first failure reasons.
  const bulkMutation = useMutation({
    mutationFn: async ({ action, ids }: { action: 'bulk-approve' | 'bulk-send'; ids: number[] }) => {
      const r = await apiRequest("POST", `/api/invoices/${action}`, { ids });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? 'Bulk action failed');
      return json;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setSelectedIds(new Set());
      const ok = vars.action === 'bulk-approve' ? data.approved : data.sent;
      const failures = (data.results ?? []).filter((x: any) => !x.ok);
      toast({
        title: `${vars.action === 'bulk-approve' ? 'Approved' : 'Sent'} ${ok}, failed ${data.failed}`,
        description: failures.slice(0, 3).map((f: any) => `#${f.id}: ${f.error}`).join(' · ') || undefined,
        variant: data.failed > 0 ? 'destructive' : 'default',
      });
    },
    onError: (e: any) => toast({ title: 'Bulk action failed', description: e.message, variant: 'destructive' }),
  });
  const toggleSelected = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const [showGenerate,   setShowGenerate]   = useState(false);
  const [previewId,      setPreviewId]      = useState<number | null>(null);
  const [previewTab,     setPreviewTab]     = useState<'preview' | 'history'>('preview');
  const [approveId,      setApproveId]      = useState<number | null>(null);
  const [sendId,         setSendId]         = useState<number | null>(null);
  const [sendForm,       setSendForm]       = useState<SendForm>(EMPTY_SEND);
  const [filterStatus,   setFilterStatus]   = useState("all");
  const [selectedIds,    setSelectedIds]    = useState<Set<number>>(new Set());
  const [form,           setForm]           = useState<FormState>(EMPTY_FORM);
  const [fetchingTariff, setFetchingTariff] = useState(false);
  const [autoTariffName, setAutoTariffName] = useState<string | null>(null);
  const [generateMode,      setGenerateMode]      = useState<'sippy' | 'snapshot'>('sippy');
  const [sippyCurrency,     setSippyCurrency]     = useState<string | null>(null);
  const [dmrGateError,      setDmrGateError]      = useState<DmrGateError | null>(null);
  const [dmrAutoResults,    setDmrAutoResults]    = useState<DmrAutoResult[] | null>(null);
  const [dmrAutoRunning,    setDmrAutoRunning]    = useState(false);
  const [snapshotGateError, setSnapshotGateError] = useState<string | null>(null);
  const [lockBatchRunning,  setLockBatchRunning]  = useState(false);
  const [lockBatchResult,   setLockBatchResult]   = useState<{ created: number; skipped: number } | null>(null);
  const [seedJobPhase,      setSeedJobPhase]      = useState<string>('');

  // ── Bulk generation (R2: multi-select client invoice generation) ──────────
  const [showBulkGen,     setShowBulkGen]     = useState(false);
  const [bulkGenSelected, setBulkGenSelected] = useState<Set<number>>(new Set());
  const [bulkGenFilter,   setBulkGenFilter]   = useState("");
  const [bulkGenMode,     setBulkGenMode]     = useState<'sippy' | 'snapshot'>('sippy');
  const [bulkGenRunning,  setBulkGenRunning]  = useState(false);
  const [bulkGenProgress, setBulkGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkGenResults,  setBulkGenResults]  = useState<BulkGenResult[] | null>(null);

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ["/api/invoices/sippy-accounts"],
    queryFn: () => apiRequest("GET", "/api/invoices/sippy-accounts").then(r => r.json()),
    staleTime: 60_000,
  });
  const accounts = accountsData?.accounts ?? [];

  // Client timezones for per-cycle period computation in the bulk dialog
  const { data: bulkGenCompaniesData } = useQuery<any>({
    queryKey: ["/api/companies"],
    queryFn: () => apiRequest("GET", "/api/companies").then(r => r.json()),
    enabled: showBulkGen,
    staleTime: 120_000,
  });
  const tzByAccount = new Map<number, string>();
  {
    const list: any[] = bulkGenCompaniesData?.companies ?? (Array.isArray(bulkGenCompaniesData) ? bulkGenCompaniesData : []);
    for (const c of list) {
      if (c.sippyAccountId && c.clientTimezone) tzByAccount.set(Number(c.sippyAccountId), c.clientTimezone);
    }
  }
  const bulkGenFilteredAccounts = accounts.filter(a =>
    a.displayName.toLowerCase().includes(bulkGenFilter.trim().toLowerCase())
  );

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

  const generateDirectMutation = useMutation({
    mutationFn: (data: FormState) =>
      apiRequest("POST", "/api/invoices/generate-from-sippy", {
        iAccount:    data.iAccount,
        periodStart: data.periodStart,
        periodEnd:   data.periodEnd,
        notes:       data.notes,
      }).then(async r => {
        if (!r.ok) {
          const body = await r.json();
          throw Object.assign(new Error(body.error ?? "Generation failed"), body);
        }
        return r.json();
      }),
    onSuccess: (data: { invoice: Invoice; lineCount: number; cdrCount: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setShowGenerate(false);
      setForm(EMPTY_FORM);
      setAutoTariffName(null);
      setSippyCurrency(null);
      setGenerateMode('sippy');
      setPreviewId(data.invoice.id);
      toast({
        title: `Invoice ${data.invoice.invoiceNumber} created (DRAFT)`,
        description: `${data.cdrCount} CDRs from Sippy · ${data.lineCount} destination groups.`,
      });
    },
    onError: (err: any) => {
      const desc = err.message?.toLowerCase().includes("fetch")
        ? "Unable to generate the invoice. Please try again or contact your administrator."
        : err.message;
      toast({ title: "Invoice generation failed", description: desc, variant: "destructive" });
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
    const periodLine = inv.periodStart
      ? `${fmtPeriodDate(inv.periodStart)} to ${fmtPeriodDate(inv.periodEnd ?? inv.periodStart)}`
      : '';
    // Lead with the invoice number: it is what a customer searches their mail
    // for, and what they quote back when querying a charge. The send date is
    // not useful in a subject — the billing period is.
    const defaultSubject = inv.periodStart
      ? `Invoice ${inv.invoiceNumber} | ${inv.customerName ?? ''} | ${fmtPeriodDate(inv.periodStart)} – ${fmtPeriodDate(inv.periodEnd ?? inv.periodStart)}`
      : `Invoice ${inv.invoiceNumber} | ${inv.customerName ?? ''}`;
    const defaultBody = `Dear ${inv.customerName ?? 'Client'} Team,\n\nPlease find attached invoice ${inv.invoiceNumber} covering the billing period ${periodLine}.\n\nKindly acknowledge receipt. Payment is due in accordance with the agreed commercial terms.\n\nFor any query regarding this invoice, please contact billing@ichibaanlogic.com. Disputes should be raised at dispute@ichibaanlogic.com.\n\nThanks and regards,\n\nIchibaan Billing Department\nInternational Voice Business\nIchibaan Logic Private Limited\n(formerly Bhaoo Private Limited)\n\nEmail   : billing@ichibaanlogic.com\nURL     : www.ichibaanlogic.com`;

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
      const currency = info.baseCurrency ?? info.base_currency ?? null;
      setSippyCurrency(currency);
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
                  title: "No billing records found",
                  description: total === 0
                    ? "No billing records were found for this account and period. Contact your administrator if this is unexpected."
                    : `${total} records fetched but none were new.`,
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
    setSippyCurrency(null);
    setGenerateMode('sippy');
    setDmrGateError(null);
    setDmrAutoResults(null);
    setSnapshotGateError(null);
    setLockBatchResult(null);
    setFetchingTariff(false);
  }

  const toggleBulkGenAccount = (id: number) => setBulkGenSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  async function runBulkGenerate() {
    const targets = accounts.filter(a => bulkGenSelected.has(a.iAccount));
    if (targets.length === 0 || bulkGenRunning) return;
    setBulkGenRunning(true);
    setBulkGenResults(null);
    setBulkGenProgress({ done: 0, total: targets.length });
    const results: BulkGenResult[] = [];

    // Duplicate guard: fetch ALL invoices fresh (the page query may be filtered)
    let existing: Invoice[] = [];
    try { existing = await apiRequest("GET", "/api/invoices").then(r => r.json()); } catch { /* server-side guard still applies */ }
    const findDup = (name: string, start: string, end: string) => existing.find(inv =>
      (inv.customerName ?? '').toLowerCase() === name.toLowerCase() &&
      inv.periodStart === start && inv.periodEnd === end && inv.status !== 'void');

    if (bulkGenMode === 'snapshot') {
      // One server call — the route generates sequentially, continue-on-error,
      // with its own duplicate guard.
      const payload = targets.map(a => {
        const p = cyclePeriod(a.billingCycle, tzByAccount.get(a.iAccount));
        return { iAccount: a.iAccount, customerName: a.displayName, periodStart: p.start, periodEnd: p.end, notes: 'Bulk generation (snapshot mode)' };
      });
      try {
        const resp = await apiRequest("POST", "/api/invoices/bulk-generate", { accounts: payload }).then(r => r.json());
        for (const t of targets) {
          const p = cyclePeriod(t.billingCycle, tzByAccount.get(t.iAccount));
          const r = (resp.results ?? []).find((x: any) => x.customerName === t.displayName);
          results.push({
            iAccount: t.iAccount, name: t.displayName, period: `${p.start} → ${p.end}`,
            status: r?.status === 'ok' ? 'ok' : r?.status === 'skipped' ? 'skipped' : 'error',
            detail: r?.status === 'ok'
              ? `Invoice ${r.invoice?.invoiceNumber ?? r.invoice?.invoice?.invoiceNumber ?? ''} · ${r.invoice?.lineCount ?? 0} lines`
              : (r?.error ?? 'No result returned'),
          });
        }
        setBulkGenProgress({ done: targets.length, total: targets.length });
      } catch (e: any) {
        for (const t of targets) results.push({ iAccount: t.iAccount, name: t.displayName, period: '', status: 'error', detail: e.message });
      }
    } else {
      // Direct-from-Sippy: one request per client, continue-on-error, live progress.
      for (const t of targets) {
        const p = cyclePeriod(t.billingCycle, tzByAccount.get(t.iAccount));
        const period = `${p.start} → ${p.end}`;
        const dup = findDup(t.displayName, p.start, p.end);
        if (dup) {
          results.push({ iAccount: t.iAccount, name: t.displayName, period, status: 'skipped', detail: `Invoice ${dup.invoiceNumber} already exists (${dup.status})` });
        } else {
          try {
            const r = await apiRequest("POST", "/api/invoices/generate-from-sippy", {
              iAccount: t.iAccount, periodStart: p.start, periodEnd: p.end, notes: 'Bulk generation',
            }).then(async res => {
              if (!res.ok) throw new Error((await res.json()).error ?? 'Generation failed');
              return res.json();
            });
            results.push({ iAccount: t.iAccount, name: t.displayName, period, status: 'ok', detail: `Invoice ${r.invoice.invoiceNumber} · ${r.cdrCount} CDRs · ${r.lineCount} lines` });
          } catch (e: any) {
            results.push({ iAccount: t.iAccount, name: t.displayName, period, status: 'error', detail: e.message });
          }
        }
        setBulkGenProgress({ done: results.length, total: targets.length });
        setBulkGenResults([...results]);
      }
    }

    setBulkGenResults(results);
    setBulkGenRunning(false);
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    const ok      = results.filter(r => r.status === 'ok').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed  = results.filter(r => r.status === 'error').length;
    toast({
      title: `Bulk generation: ${ok} created, ${skipped} skipped, ${failed} failed`,
      variant: failed > 0 ? 'destructive' : 'default',
    });
  }

  const periodLabel = form.billingCycle !== "custom" && form.periodStart
    ? computeBillingPeriod(form.billingCycle as "weekly" | "monthly", form.clientTimezone).label
    : null;

  const selectedTariff = tariffs.find(t => String(t.iTariff) === form.iTariff);

  const stats = {
    total:      invoices.length,
    draft:      invoices.filter(i => i.status === "draft").length,
    approved:   invoices.filter(i => i.status === "approved").length,
    // BILLED, not reproduced. This card summed totalReproduced — the rating
    // engine's figure, currently 60x the switch's — so the headline on the
    // Finance page read $10,083.47 for a set of invoices actually worth about
    // $168. totalActual is Σ actual_cost: what the customer is charged, and the
    // only figure on this page that is money.
    totalValue: invoices.reduce((s, i) => s + (i.totalActual ?? 0), 0),
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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            data-testid="button-export-invoices"
            onClick={() => {
              const rows = invoices.map(inv => ({
                "Invoice #":    inv.invoiceNumber,
                "Customer":     inv.customerName  ?? "",
                "Tariff":       inv.iTariff       ?? "",
                "Period Start": inv.periodStart   ?? "",
                "Period End":   inv.periodEnd     ?? "",
                "Lines":        inv.lineCount     ?? "",
                "DMR Amount":    inv.totalReproduced != null ? Number(inv.totalReproduced).toFixed(4) : "",
                "Sippy Amount":  inv.totalActual     != null ? Number(inv.totalActual).toFixed(4)     : "",
                "Difference":    inv.totalDelta      != null ? Number(inv.totalDelta).toFixed(4)      : "",
                "Status":       inv.status,
                "Generated At": inv.generatedAt   ?? "",
                "Approved At":  inv.approvedAt    ?? "",
                "Sent At":      inv.sentAt        ?? "",
                "Notes":        inv.notes         ?? "",
              }));
              exportToExcel([{ name: "Invoices", rows }], `Invoices-${new Date().toISOString().slice(0,10)}`);
            }}
            disabled={invoices.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />Export
          </Button>
          <Button
            variant="outline"
            data-testid="button-bulk-generate"
            onClick={() => {
              setBulkGenSelected(new Set());
              setBulkGenFilter("");
              setBulkGenMode('sippy');
              setBulkGenResults(null);
              setBulkGenProgress(null);
              setShowBulkGen(true);
            }}
          >
            <Layers className="h-4 w-4 mr-2" />Bulk Generate
          </Button>
          <Button data-testid="button-generate-invoice" onClick={() => { setForm(EMPTY_FORM); setAutoTariffName(null); setDmrGateError(null); setDmrAutoResults(null); setShowGenerate(true); }}>
            <Play className="h-4 w-4 mr-2" />Generate Invoice
          </Button>
        </div>
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
          { label: "Total Billed",   value: `$${stats.totalValue.toFixed(2)}`, icon: <DollarSign className="h-4 w-4 text-slate-400" /> },
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
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2" data-testid="bulk-toolbar">
                <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                  data-testid="button-bulk-approve"
                  disabled={bulkMutation.isPending}
                  onClick={() => bulkMutation.mutate({ action: 'bulk-approve', ids: [...selectedIds] })}>
                  Approve Selected
                </Button>
                <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                  data-testid="button-bulk-send"
                  disabled={bulkMutation.isPending}
                  onClick={() => bulkMutation.mutate({ action: 'bulk-send', ids: [...selectedIds] })}>
                  Send Selected
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  onClick={() => setSelectedIds(new Set())}>Clear</Button>
              </div>
            )}
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="select-filter-status" className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all","draft","review","approved","sent","paid","disputed","rejected","void"].map(s => (
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
                    <TableHead className="w-8">
                      <input type="checkbox" className="h-4 w-4 rounded border-border" data-testid="checkbox-select-all"
                        checked={invoices.length > 0 && invoices.every(i => selectedIds.has(i.id))}
                        onChange={e => setSelectedIds(e.target.checked ? new Set(invoices.map(i => i.id)) : new Set())} />
                    </TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Period</TableHead>
                    {/* Order MUST match the cells below: lineCount, totalReproduced,
                        totalActual, totalDelta. `Lines` used to be declared last of
                        these four while being rendered first, so every money column
                        sat under the wrong header: an invoice billing $0.28 displayed
                        its REPRODUCED $16.52 under "Billed Amount", and its delta
                        under "Lines". An operator reading the register saw a figure
                        60x the one on the customer's invoice. */}
                    <TableHead>Lines</TableHead>
                    <TableHead className="text-right text-xs">Verified Amount</TableHead>
                    <TableHead className="text-right text-xs">Billed Amount</TableHead>
                    <TableHead className="text-right text-xs">Difference</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(inv => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell>
                        <input type="checkbox" className="h-4 w-4 rounded border-border" data-testid={`checkbox-invoice-${inv.id}`}
                          checked={selectedIds.has(inv.id)} onChange={() => toggleSelected(inv.id)} />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-sm">{inv.customerName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {inv.periodStart ?? "—"} → {inv.periodEnd ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{inv.lineCount?.toLocaleString() ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-right">${(inv.totalReproduced ?? 0).toFixed(4)}</TableCell>
                      <TableCell className="font-mono text-xs text-right">${(inv.totalActual ?? 0).toFixed(4)}</TableCell>
                      <TableCell className="font-mono text-xs text-right">
                        {(() => {
                          const delta = inv.totalDelta ?? 0;
                          const base  = inv.totalReproduced ?? 0;
                          const pct   = base > 0 ? Math.abs(delta / base) * 100 : 0;
                          const cls   = pct < 2 ? 'text-emerald-400' : pct < 5 ? 'text-amber-400' : 'text-red-400';
                          return <span className={cls}>{delta >= 0 ? '+' : ''}{delta.toFixed(4)}</span>;
                        })()}
                      </TableCell>
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
                          {(inv.status === "draft" || inv.status === "review") && (
                            <Button variant="ghost" size="sm" title="Reject invoice"
                              onClick={() => {
                                const reason = window.prompt('Rejection reason:');
                                if (reason) apiRequest('POST', `/api/invoices/${inv.id}/reject`, { reason })
                                  .then(() => qc.invalidateQueries({ queryKey: ['/api/invoices'] }));
                              }}>
                              <XCircle className="h-3.5 w-3.5 text-red-400" />
                            </Button>
                          )}
                          {(inv.status === "approved" || inv.status === "sent") && (
                            <Button
                              data-testid={`button-send-${inv.id}`}
                              variant="ghost" size="sm"
                              title="Send invoice via email"
                              onClick={() => openSendDialog(inv)}>
                              <Send className="h-3.5 w-3.5 text-blue-400" />
                            </Button>
                          )}
                          {(inv.status === "approved" || inv.status === "sent") && (
                            <Button variant="ghost" size="sm" title="Download PDF"
                              onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, '_blank')}>
                              <FileDown className="h-3.5 w-3.5 text-slate-400" />
                            </Button>
                          )}
                          {inv.status === "sent" && (
                            <Button variant="ghost" size="sm" title="Mark as Paid"
                              onClick={() => {
                                const ref = window.prompt('Payment reference (USDT txid / Bank ref):');
                                if (ref) apiRequest('POST', `/api/invoices/${inv.id}/mark-paid`, { reference: ref, method: 'usdt' })
                                  .then(() => qc.invalidateQueries({ queryKey: ['/api/invoices'] }));
                              }}>
                              <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                            </Button>
                          )}
                          {inv.status === "sent" && (
                            <Button variant="ghost" size="sm" title="Raise Dispute"
                              onClick={() => {
                                const note = window.prompt('Dispute reason:');
                                if (note) apiRequest('POST', `/api/invoices/${inv.id}/dispute`, { note })
                                  .then(() => qc.invalidateQueries({ queryKey: ['/api/invoices'] }));
                              }}>
                              <Flag className="h-3.5 w-3.5 text-amber-400" />
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
      {/* ── Bulk Generate dialog (R2: multi-select client generation) ────── */}
      <Dialog open={showBulkGen} onOpenChange={o => { if (!o && !bulkGenRunning) setShowBulkGen(false); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />Bulk Generate Invoices
            </DialogTitle>
            <DialogDescription>
              Each selected client is invoiced for its own billing period (weekly → last full week,
              bi-weekly → last two weeks, monthly → last full month). Drafts only — nothing is
              approved or emailed from here.
            </DialogDescription>
          </DialogHeader>

          {bulkGenResults === null && (
            <>
              <div className="flex items-center gap-2">
                <Button size="sm" variant={bulkGenMode === 'sippy' ? 'default' : 'outline'}
                  disabled={bulkGenRunning} onClick={() => setBulkGenMode('sippy')}
                  data-testid="button-bulkgen-mode-sippy">
                  <Zap className="h-3.5 w-3.5 mr-1.5" />From Sippy CDRs
                </Button>
                <Button size="sm" variant={bulkGenMode === 'snapshot' ? 'default' : 'outline'}
                  disabled={bulkGenRunning} onClick={() => setBulkGenMode('snapshot')}
                  data-testid="button-bulkgen-mode-snapshot">
                  <Lock className="h-3.5 w-3.5 mr-1.5" />From Locked Snapshots
                </Button>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                {bulkGenMode === 'sippy'
                  ? "Fetches each client's CDRs directly from Sippy and builds destination line items — same path as single-invoice generation."
                  : "Uses only locked immutable rating snapshots. Clients without locked snapshots for the period will fail with a clear reason."}
              </p>

              <Input
                placeholder="Filter clients…"
                value={bulkGenFilter}
                onChange={e => setBulkGenFilter(e.target.value)}
                disabled={bulkGenRunning}
                data-testid="input-bulkgen-filter"
              />

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 rounded border-border"
                    data-testid="checkbox-bulkgen-select-all"
                    disabled={bulkGenRunning}
                    checked={bulkGenFilteredAccounts.length > 0 && bulkGenFilteredAccounts.every(a => bulkGenSelected.has(a.iAccount))}
                    onChange={e => {
                      const next = new Set(bulkGenSelected);
                      for (const a of bulkGenFilteredAccounts) e.target.checked ? next.add(a.iAccount) : next.delete(a.iAccount);
                      setBulkGenSelected(next);
                    }}
                  />
                  Select all {bulkGenFilter ? "(filtered)" : ""}
                </label>
                <span className="text-muted-foreground">{bulkGenSelected.size} selected</span>
              </div>

              <div className="border border-border rounded-lg divide-y divide-border max-h-72 overflow-y-auto">
                {accountsLoading && (
                  <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />Loading clients…
                  </div>
                )}
                {!accountsLoading && bulkGenFilteredAccounts.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">No clients match.</div>
                )}
                {bulkGenFilteredAccounts.map(a => {
                  const p = cyclePeriod(a.billingCycle, tzByAccount.get(a.iAccount));
                  return (
                    <label key={a.iAccount} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                      <input type="checkbox" className="h-4 w-4 rounded border-border"
                        data-testid={`checkbox-bulkgen-${a.iAccount}`}
                        disabled={bulkGenRunning}
                        checked={bulkGenSelected.has(a.iAccount)}
                        onChange={() => toggleBulkGenAccount(a.iAccount)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{a.displayName}</div>
                        <div className="text-xs text-muted-foreground">{p.start} → {p.end}</div>
                      </div>
                      {cycleBadge(a.billingCycle) && (
                        <Badge variant="outline" className="text-xs shrink-0">{cycleBadge(a.billingCycle)}</Badge>
                      )}
                      {a.blocked && (
                        <Badge variant="outline" className="text-xs shrink-0 text-amber-400 border-amber-500/30">Blocked</Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {bulkGenProgress && (bulkGenRunning || bulkGenResults) && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              {bulkGenRunning && <RefreshCw className="h-4 w-4 animate-spin" />}
              {bulkGenRunning
                ? `Generating ${bulkGenProgress.done} / ${bulkGenProgress.total}…`
                : `Finished ${bulkGenProgress.done} / ${bulkGenProgress.total}`}
            </div>
          )}

          {bulkGenResults && (
            <div className="border border-border rounded-lg divide-y divide-border max-h-72 overflow-y-auto">
              {bulkGenResults.map(r => (
                <div key={`${r.iAccount}-${r.period}`} className="flex items-start gap-3 px-3 py-2">
                  {r.status === 'ok'      && <CheckCircle   className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />}
                  {r.status === 'skipped' && <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />}
                  {r.status === 'error'   && <XCircle       className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.name}
                      {r.period && <span className="text-xs text-muted-foreground font-normal ml-2">{r.period}</span>}
                    </div>
                    <div className={`text-xs ${r.status === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}>{r.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {bulkGenResults === null ? (
              <>
                <Button variant="outline" disabled={bulkGenRunning} onClick={() => setShowBulkGen(false)}>Cancel</Button>
                <Button
                  data-testid="button-bulkgen-run"
                  disabled={bulkGenRunning || bulkGenSelected.size === 0}
                  onClick={runBulkGenerate}
                >
                  {bulkGenRunning
                    ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Generating…</>
                    : <><Play className="h-4 w-4 mr-2" />Generate Selected ({bulkGenSelected.size})</>}
                </Button>
              </>
            ) : (
              <>
                {!bulkGenRunning && bulkGenResults.some(r => r.status === 'error') && (
                  <Button variant="outline" onClick={() => { setBulkGenResults(null); setBulkGenProgress(null); }}>
                    Back to selection
                  </Button>
                )}
                <Button disabled={bulkGenRunning} onClick={() => setShowBulkGen(false)}>Done</Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showGenerate} onOpenChange={o => { if (!o) resetModal(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Invoice</DialogTitle>
            <DialogDescription>
              {generateMode === 'sippy'
                ? "Fetches billing records for the selected account and period."
                : "Creates a DRAFT invoice from locked immutable rating snapshots."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">

            {/* ── Client Account (shared by both modes) ── */}
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
                  <RefreshCw className="h-3 w-3 animate-spin" /> Fetching account details…
                </p>
              )}
            </div>

            {/* ── Sippy mode: read-only account info strip ── */}
            {generateMode === 'sippy' && form.iAccount && !fetchingTariff && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <span className="flex items-center gap-1.5 text-foreground font-medium">
                  <User className="h-3 w-3 text-muted-foreground" />
                  {form.customerName || accounts.find(a => String(a.iAccount) === form.iAccount)?.displayName || `Account #${form.iAccount}`}
                </span>
                {autoTariffName && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <span className="w-1 h-1 rounded-full bg-border inline-block" />
                    {autoTariffName}
                    {form.iTariff && <span className="font-mono text-[10px] text-muted-foreground/70 ml-0.5">(ID {form.iTariff})</span>}
                  </span>
                )}
                {sippyCurrency && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <span className="w-1 h-1 rounded-full bg-border inline-block" />
                    {sippyCurrency}
                  </span>
                )}
              </div>
            )}

            {/* ── Snapshot mode: Customer Name + Tariff fields ── */}
            {generateMode === 'snapshot' && (
              <>
                <div>
                  <Label className="text-xs mb-1.5 block">Customer Name</Label>
                  <Input
                    data-testid="input-customer-name"
                    value={form.customerName}
                    onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                    placeholder="Auto-filled from account selection"
                  />
                </div>

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
                          !form.iAccount       ? "Select a client account first" :
                          fetchingTariff       ? "Fetching…" :
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
                  {form.iTariff && !fetchingTariff && (
                    <p className="text-xs text-emerald-400 mt-1.5 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {selectedTariff
                        ? `${selectedTariff.name} · ${selectedTariff.currency} · ID ${selectedTariff.iTariff}`
                        : `Tariff ID ${form.iTariff} selected`}
                      {autoTariffName && <span className="text-muted-foreground ml-1">(auto-matched)</span>}
                    </p>
                  )}
                </div>
              </>
            )}

            {/* ── Billing Cycle (shared) ── */}
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

            {/* ── Period dates (shared) ── */}
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

            {/* ── Notes (shared) ── */}
            <div>
              <Label className="text-xs mb-1.5 block">Notes (optional)</Label>
              <Input
                data-testid="input-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Payment terms, references…"
              />
            </div>

            {/* ── Sippy mode: Generate button ── */}
            {generateMode === 'sippy' && (
              <Button
                data-testid="button-confirm-generate-sippy"
                className="w-full"
                onClick={() => generateDirectMutation.mutate(form)}
                disabled={!form.iAccount || !form.periodStart || !form.periodEnd || generateDirectMutation.isPending || fetchingTariff}
              >
                {generateDirectMutation.isPending
                  ? <><RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />Fetching billing data…</>
                  : !form.iAccount
                    ? "Select a client account"
                    : !form.periodStart || !form.periodEnd
                      ? "Select billing period"
                      : <><Zap className="h-3.5 w-3.5 mr-1.5" />Generate Invoice</>
                }
              </Button>
            )}

            {/* ── Snapshot mode gate errors + generate button ── */}
            {generateMode === 'snapshot' && (
              <>
                {snapshotGateError && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <Lock className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-amber-400">No Locked Snapshots — Pre-requisite Required</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Snapshot-based generation requires immutable CDR rating snapshots to be crystallised first.
                          This is a two-step process: <span className="text-amber-300 font-medium">Rating Verification → Lock Batch</span>.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
                      <Layers className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400/70" />
                      <span>
                        Step 1 fetches billing records for the selected account and period.
                        Step 2 crystallises verified records into locked, immutable snapshots used for invoice line items.
                      </span>
                    </div>
                    {lockBatchResult && lockBatchResult.created === 0 && (
                      <div className="text-xs text-muted-foreground px-1">
                        <span className="text-amber-300 font-medium">0 new snapshots created</span>
                        {lockBatchResult.skipped > 0
                          ? ` — ${lockBatchResult.skipped} snapshot(s) already exist for this period.`
                          : " — No billing records found for this account and period. Contact your administrator if this is unexpected."}
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
                        : <><Zap className="h-3.5 w-3.5 mr-2" />Fetch &amp; Lock Billing Records</>
                      }
                    </Button>
                  </div>
                )}

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
                          : "Generate Draft Invoice (Snapshots)"}
                </Button>
              </>
            )}

            {/* ── Mode toggle strip ── */}
            <div className="pt-1 border-t border-border/50 flex items-center justify-center">
              {generateMode === 'sippy' ? (
                <button
                  type="button"
                  data-testid="button-switch-snapshot-mode"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  onClick={() => { setGenerateMode('snapshot'); setDmrGateError(null); setSnapshotGateError(null); }}
                >
                  <Lock className="h-3 w-3" /> Advanced: Use locked immutable snapshots (audit-grade)
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="button-switch-sippy-mode"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  onClick={() => { setGenerateMode('sippy'); setDmrGateError(null); setSnapshotGateError(null); }}
                >
                  ← Standard mode
                </button>
              )}
            </div>

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
            <div className="flex-1 overflow-auto flex flex-col gap-3">
              {/* Provenance the approver would otherwise open three pages to find.
                  certificationStatus is the state AT GENERATION TIME, so it says
                  what was true when this document was built — not what is true now. */}
              {preview && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs rounded border border-border p-3">
                  <div><span className="text-muted-foreground">Certification</span><div className="font-medium">
                    {preview.certificationStatus
                      ? <span className={preview.certificationStatus === 'certified' ? 'text-emerald-400' : 'text-amber-400'}>{preview.certificationStatus}</span>
                      : <span className="text-muted-foreground">not recorded</span>}
                  </div></div>
                  <div><span className="text-muted-foreground">Verification run</span><div className="font-medium font-mono">{preview.verificationRunId ?? "—"}</div></div>
                  <div><span className="text-muted-foreground">Tariff</span><div className="font-medium font-mono">{preview.iTariff ?? "—"}</div></div>
                  <div><span className="text-muted-foreground">Generated</span><div className="font-medium">{preview.generatedAt ? new Date(preview.generatedAt).toLocaleString() : "—"}</div></div>
                  {preview.overrideReason && (
                    <div className="col-span-2 md:col-span-4 pt-1 border-t border-border/60">
                      <span className="text-muted-foreground">Override</span>
                      <div className="font-medium text-amber-400">
                        {preview.overrideReason}{preview.overriddenBy ? ` — ${preview.overriddenBy}` : ""}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button
                  data-testid="button-download-pdf-preview" size="sm" variant="outline"
                  onClick={() => preview && window.open(`/api/invoices/${preview.id}/pdf`, "_blank")}
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" /> Download PDF
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  This is the exact document the customer receives — same renderer, same source.
                </span>
              </div>
              {/* The canonical PDF, not a second rendering of it. Two renderers
                  drift: the HTML blob this replaced showed 1880 at 0.59100 for
                  $16.52 while the customer's PDF showed Bangladesh at 0.00985
                  for $0.28, same invoice, same minutes. One renderer cannot
                  disagree with itself. */}
              <div className="flex-1 rounded border border-border overflow-hidden">
                {preview ? (
                  <iframe
                    data-testid="iframe-invoice-preview"
                    src={`/api/invoices/${preview.id}/pdf#toolbar=0`}
                    className="w-full min-h-[600px] h-full"
                    title="Invoice Preview"
                  />
                ) : (
                  <div className="text-center py-10 text-muted-foreground">Loading invoice…</div>
                )}
              </div>
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
                  <p className="text-xs text-muted-foreground">The invoice is attached automatically, named for the client, invoice number and period. A summary of the amount and period is included in the email body.</p>
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
