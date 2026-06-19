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
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowRightLeft, Play, AlertTriangle, CheckCircle2, TrendingDown,
  Eye, DollarSign, ShieldAlert, Info, Download, FileText, Loader2, FileSpreadsheet, Mail, History,
  Calendar, Clock, Trash2, Plus, ToggleLeft, ToggleRight, Send, Pencil,
} from "lucide-react";

interface CarrierReconciliation {
  id:                        number;
  carrierName:               string;
  iTariff?:                  string;
  invoiceRef?:               string;
  invoiceDate?:              string;
  periodStart?:              string;
  periodEnd?:                string;
  carrierTotal?:             number;
  sippyTotal?:               number;
  reproducedTotal?:          number;
  snapshotTotal?:            number;
  deltaCarrierVsReproduced?: number;
  deltaCarrierVsSippy?:      number;
  discrepancyCount?:         number;
  status:                    string;
  notes?:                    string;
  createdAt:                 string;
}

interface ReconciliationResult {
  reconciliation: CarrierReconciliation;
  analysis: {
    deltaCarrierVsReproduced: number;
    deltaCarrierVsSippy:      number;
    deltaSippyVsReproduced:   number;
    discrepancyType:          string;
    severity:                 string;
    snapshotCount:            number;
    recommendations:          string[];
  };
}

interface SippyTariff { iTariff: string | number; name: string; }

interface ReconEmailLog {
  id: number;
  sentAt: string;
  senderUserId: string | null;
  senderName: string | null;
  recipientEmail: string;
  reportType: string;
  format: string;
  filename: string | null;
  subject: string | null;
  status: string;
  errorMessage: string | null;
}

function SeverityBadge({ severity }: { severity: string }) {
  const cfg: Record<string, string> = {
    none:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    minor:    "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    major:    "bg-orange-500/15 text-orange-400 border-orange-500/30",
    critical: "bg-red-500/20 text-red-400 border-red-500/40",
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${cfg[severity] ?? cfg.none}`}>
      {severity}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    shadow:   "bg-slate-500/15 text-slate-400 border-slate-500/30",
    pending:  "bg-blue-500/15 text-blue-400 border-blue-500/30",
    reviewed: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    resolved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    disputed: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${cfg[status] ?? cfg.shadow}`}>
      {status === 'shadow' ? '🔍 Shadow' : status}
    </Badge>
  );
}

function DiscrepancyTypeLabel({ type }: { type: string }) {
  const map: Record<string, string> = {
    exact_match:               "Exact Match",
    overbilled_by_carrier:     "Carrier Overbilled",
    underbilled_by_carrier:    "Carrier Underbilled",
    sippy_vs_reproduced_drift: "Sippy/Reproduced Drift",
    large_discrepancy:         "Large Discrepancy",
    missing_snapshots:         "Missing Snapshots",
  };
  return <span>{map[type] ?? type}</span>;
}

function buildExportUrl(
  base: string,
  params: {
    iTariff?: string;
    periodStart?: string;
    periodEnd?: string;
    status?: string;
    reconStatus?: string;
    vendor?: string;
    mode?: string;
  },
): string {
  const p = new URLSearchParams();
  if (params.iTariff)     p.set('iTariff',     params.iTariff);
  if (params.periodStart) p.set('periodStart', params.periodStart);
  if (params.periodEnd)   p.set('periodEnd',   params.periodEnd);
  if (params.status && params.status !== 'all') p.set('status', params.status);
  if (params.reconStatus && params.reconStatus !== 'all') p.set('reconStatus', params.reconStatus);
  if (params.vendor)      p.set('vendor',      params.vendor);
  if (params.mode)        p.set('mode',        params.mode);
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

export default function CarrierReconciliationPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showForm, setShowForm]       = useState(false);
  const [detailId, setDetailId]       = useState<number | null>(null);
  const [lastResult, setLastResult]   = useState<ReconciliationResult | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTariff, setFilterTariff] = useState("");
  const [filterPeriodStart, setFilterPeriodStart] = useState("");
  const [filterPeriodEnd, setFilterPeriodEnd]     = useState("");
  const [exporting, setExporting]           = useState<'csv' | 'pdf' | null>(null);
  const [exportingDetail, setExportingDetail] = useState<'csv' | 'pdf' | 'full-csv' | null>(null);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailForm, setEmailForm] = useState({
    to: '', subject: 'Carrier Reconciliation Report', message: '', format: 'pdf' as 'pdf' | 'csv', mode: 'cdr' as 'cdr' | 'summary',
  });

  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ReconSchedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    name: 'Monthly Carrier Reconciliation',
    recipients: '',
    format: 'pdf' as 'pdf' | 'csv',
    frequency: 'monthly' as 'monthly' | 'weekly',
    dayOfMonth: 1,
    dayOfWeek: 1,
    cronHour: 8,
    carrierTariff: '',
  });

  function parseEmailList(raw: string): string[] {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function validateEmailList(raw: string): string | null {
    const parts = parseEmailList(raw);
    if (parts.length === 0) return 'At least one email address is required.';
    const invalid = parts.filter(e => !EMAIL_RE.test(e));
    if (invalid.length > 0) return `Invalid address${invalid.length > 1 ? 'es' : ''}: ${invalid.join(', ')}`;
    return null;
  }
  const emailListError = emailForm.to ? validateEmailList(emailForm.to) : null;

  const emailMutation = useMutation({
    mutationFn: (data: typeof emailForm) =>
      apiRequest("POST", "/api/billing/reconciliation/export/email", {
        ...data,
        iTariff:     filterTariff || undefined,
        vendor:      filterTariff || undefined,
        periodStart: filterPeriodStart || undefined,
        periodEnd:   filterPeriodEnd   || undefined,
        reconStatus: filterStatus !== 'all' ? filterStatus : undefined,
      }).then(r => r.json()),
    onSuccess: (data: any) => {
      const recipients = parseEmailList(emailForm.to);
      const recipientDesc = recipients.length > 1 ? `${recipients.length} recipients` : emailForm.to.trim();
      toast({ title: `Report emailed`, description: `Sent ${data.filename} to ${recipientDesc}` });
      setShowEmailDialog(false);
    },
    onError: (err: any) => {
      toast({ title: 'Email failed', description: err.message, variant: 'destructive' });
    },
  });

  interface ReconSchedule { id: number; name: string; reportType: string; recipients: string; format: string; frequency: string; dayOfMonth: number | null; dayOfWeek: number | null; cronHour: number; carrierTariff: string | null; enabled: boolean; lastSentAt: string | null; nextDueAt: string | null; createdAt: string; }
  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<ReconSchedule[]>({
    queryKey: ["/api/reconciliation-report-schedules"],
    select: (data) => data.filter(s => s.reportType === 'carrier'),
  });

  const createScheduleMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/reconciliation-report-schedules", body).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Schedule created", description: "Report will be sent automatically on schedule." });
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliation-report-schedules"] });
      setShowScheduleDialog(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateScheduleMut = useMutation({
    mutationFn: ({ id, ...body }: any) => apiRequest("PATCH", `/api/reconciliation-report-schedules/${id}`, body).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Schedule updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliation-report-schedules"] });
      setShowScheduleDialog(false);
      setEditingSchedule(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleScheduleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/reconciliation-report-schedules/${id}`, { enabled }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/reconciliation-report-schedules"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteScheduleMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/reconciliation-report-schedules/${id}`).then(r => r.json()),
    onSuccess: () => { toast({ title: "Schedule deleted" }); queryClient.invalidateQueries({ queryKey: ["/api/reconciliation-report-schedules"] }); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const sendNowMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/reconciliation-report-schedules/${id}/send-now`).then(r => r.json()),
    onSuccess: () => toast({ title: "Report sent", description: "The report was delivered immediately." }),
    onError: (err: any) => toast({ title: "Send failed", description: err.message, variant: "destructive" }),
  });

  const [form, setForm] = useState({
    carrierName: "", iTariff: "", invoiceRef: "", invoiceDate: "",
    periodStart: "", periodEnd: "", carrierTotal: "", notes: "",
  });

  const { data: tariffs = [] } = useQuery<SippyTariff[]>({ queryKey: ["/api/sippy/tariffs"] });

  const { data: emailLogs = [] } = useQuery<ReconEmailLog[]>({
    queryKey: ["/api/reconciliation/email-log"],
    refetchInterval: 30_000,
  });

  const { data: reconciliations = [], isLoading } = useQuery<CarrierReconciliation[]>({
    queryKey: ["/api/carrier-reconciliations", filterStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      return apiRequest("GET", `/api/carrier-reconciliations?${params}`).then(r => r.json());
    },
  });

  const { data: detail } = useQuery<CarrierReconciliation>({
    queryKey: ["/api/carrier-reconciliations", detailId],
    queryFn: () => apiRequest("GET", `/api/carrier-reconciliations/${detailId}`).then(r => r.json()),
    enabled: detailId != null,
  });

  const runMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiRequest("POST", "/api/carrier-reconciliations/run", {
        ...data,
        carrierTotal: parseFloat(data.carrierTotal),
      }).then(r => r.json()),
    onSuccess: (data: ReconciliationResult) => {
      setLastResult(data);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-reconciliations"] });
      const delta = Math.abs(data.analysis.deltaCarrierVsReproduced ?? 0);
      toast({
        title: `Reconciliation complete — ${data.analysis.discrepancyType.replace(/_/g, ' ')}`,
        description: `Delta: $${delta.toFixed(4)} · Severity: ${data.analysis.severity} · ${data.analysis.snapshotCount} snapshots`,
        variant: data.analysis.severity === 'critical' ? 'destructive' : 'default',
      });
    },
    onError: (err: any) => {
      toast({ title: "Reconciliation failed", description: err.message, variant: "destructive" });
    },
  });

  async function handleDetailExport(type: 'csv' | 'pdf' | 'full-csv') {
    if (!detail) return;
    setExportingDetail(type);
    try {
      let url: string;
      if (type === 'full-csv') {
        url = `/api/billing/reconciliation/export/csv-full?reconId=${detail.id}`;
      } else {
        const base = type === 'csv'
          ? '/api/billing/reconciliation/export/csv'
          : '/api/billing/reconciliation/export/pdf';
        url = buildExportUrl(base, {
          iTariff:     detail.iTariff || undefined,
          periodStart: detail.periodStart || undefined,
          periodEnd:   detail.periodEnd || undefined,
          mode:        type === 'csv' ? 'cdr' : undefined,
        });
      }
      const res = await fetch(url);
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const j = await res.json();
        if (j.large) {
          const dl = await fetch(`/api/billing/reconciliation/export/download/${j.token}`);
          const blob = await dl.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = j.filename;
          a.click();
          toast({ title: `Export ready — ${j.rowCount.toLocaleString()} rows` });
        }
      } else {
        const blob = await res.blob();
        const cd = res.headers.get('content-disposition') ?? '';
        const carrier = detail.carrierName.replace(/\s+/g, '-');
        const period = detail.periodStart ?? 'all';
        const ext = type === 'pdf' ? 'pdf' : 'xlsx';
        const fallback = `recon-${carrier}-${period}.${ext}`;
        const fn = cd.match(/filename="([^"]+)"/)?.[1] ?? fallback;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fn;
        a.click();
        const label = type === 'full-csv' ? 'Full Report Excel exported' : type === 'csv' ? 'Excel exported' : 'PDF report exported';
        toast({ title: label });
      }
    } catch (e: any) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    } finally {
      setExportingDetail(null);
    }
  }

  const stats = {
    total:       reconciliations.length,
    withDelta:   reconciliations.filter(r => Math.abs(r.deltaCarrierVsReproduced ?? 0) > 0.5).length,
    critical:    reconciliations.filter(r => Math.abs(r.deltaCarrierVsReproduced ?? 0) >= 50).length,
    totalSaved:  reconciliations.reduce((s, r) => s + Math.max(0, -(r.deltaCarrierVsReproduced ?? 0)), 0),
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6 text-primary" />
            Carrier Invoice Reconciliation
          </h1>
          <p className="text-muted-foreground mt-1">
            Compare vendor invoices against Sippy actuals and BitsAuto reproduced costs. Shadow verification mode — intelligence only, no automatic accounting actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-export-dropdown" disabled={exporting !== null}>
                {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="button-export-csv-cdr"
                onClick={async () => {
                  setExporting('csv');
                  try {
                    const url = buildExportUrl('/api/billing/reconciliation/export/csv', {
                      mode: 'cdr',
                      iTariff: filterTariff || undefined,
                      vendor: filterTariff || undefined,
                      periodStart: filterPeriodStart || undefined,
                      periodEnd: filterPeriodEnd || undefined,
                      reconStatus: filterStatus !== 'all' ? filterStatus : undefined,
                    });
                    const res = await fetch(url);
                    const ct = res.headers.get('content-type') ?? '';
                    if (ct.includes('application/json')) {
                      const j = await res.json();
                      if (j.large) {
                        const dl = await fetch(`/api/billing/reconciliation/export/download/${j.token}`);
                        const blob = await dl.blob();
                        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = j.filename; a.click();
                        toast({ title: `Export ready — ${j.rowCount.toLocaleString()} rows` });
                      }
                    } else {
                      const blob = await res.blob();
                      const cd = res.headers.get('content-disposition') ?? '';
                      const fn = cd.match(/filename="([^"]+)"/)?.[1] ?? 'reconciliation.xlsx';
                      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click();
                      toast({ title: 'Excel exported' });
                    }
                  } catch (e: any) { toast({ title: 'Export failed', description: e.message, variant: 'destructive' }); }
                  finally { setExporting(null); }
                }}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-400" />
                CDR Snapshot Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="button-export-csv-summary"
                onClick={async () => {
                  setExporting('csv');
                  try {
                    const url = buildExportUrl('/api/billing/reconciliation/export/csv', {
                      mode: 'summary',
                      iTariff: filterTariff || undefined,
                      vendor: filterTariff || undefined,
                      reconStatus: filterStatus !== 'all' ? filterStatus : undefined,
                    });
                    const res = await fetch(url);
                    const ct = res.headers.get('content-type') ?? '';
                    if (ct.includes('application/json')) {
                      const j = await res.json();
                      if (j.large) {
                        const dl = await fetch(`/api/billing/reconciliation/export/download/${j.token}`);
                        const blob = await dl.blob();
                        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = j.filename; a.click();
                      }
                    } else {
                      const blob = await res.blob();
                      const cd = res.headers.get('content-disposition') ?? '';
                      const fn = cd.match(/filename="([^"]+)"/)?.[1] ?? 'reconciliation-summary.xlsx';
                      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click();
                    }
                    toast({ title: 'Summary Excel exported' });
                  } catch (e: any) { toast({ title: 'Export failed', description: e.message, variant: 'destructive' }); }
                  finally { setExporting(null); }
                }}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2 text-blue-400" />
                Summary Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="button-export-pdf"
                onClick={async () => {
                  setExporting('pdf');
                  try {
                    const url = buildExportUrl('/api/billing/reconciliation/export/pdf', {
                      iTariff: filterTariff || undefined,
                      vendor: filterTariff || undefined,
                      periodStart: filterPeriodStart || undefined,
                      periodEnd: filterPeriodEnd || undefined,
                      reconStatus: filterStatus !== 'all' ? filterStatus : undefined,
                    });
                    const res = await fetch(url);
                    const ct = res.headers.get('content-type') ?? '';
                    if (ct.includes('application/json')) {
                      const j = await res.json();
                      if (j.large) {
                        const dl = await fetch(`/api/billing/reconciliation/export/download/${j.token}`);
                        const blob = await dl.blob();
                        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = j.filename; a.click();
                      }
                    } else {
                      const blob = await res.blob();
                      const cd = res.headers.get('content-disposition') ?? '';
                      const fn = cd.match(/filename="([^"]+)"/)?.[1] ?? 'reconciliation.pdf';
                      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click();
                    }
                    toast({ title: 'PDF report exported' });
                  } catch (e: any) { toast({ title: 'Export failed', description: e.message, variant: 'destructive' }); }
                  finally { setExporting(null); }
                }}
              >
                <FileText className="h-4 w-4 mr-2 text-red-400" />
                PDF Report
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="button-email-report"
                onClick={() => setShowEmailDialog(true)}
              >
                <Mail className="h-4 w-4 mr-2 text-blue-400" />
                Email Report…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="button-schedule-report"
                onClick={() => setShowScheduleDialog(true)}
              >
                <Calendar className="h-4 w-4 mr-2 text-violet-400" />
                Schedule Report…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button data-testid="button-run-reconciliation" onClick={() => setShowForm(true)}>
            <Play className="h-4 w-4 mr-2" />Run Reconciliation
          </Button>
        </div>
      </div>

      {/* Shadow mode notice */}
      <div className="flex items-start gap-3 bg-slate-500/10 border border-slate-500/30 rounded-lg p-4">
        <ShieldAlert className="h-5 w-5 text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-slate-300">Shadow Verification Mode</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            All reconciliations run in shadow mode. Discrepancies are detected and reported as intelligence.
            No automatic accounting actions. Human review required before any financial adjustments.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Runs",     value: stats.total,       icon: <ArrowRightLeft className="h-4 w-4 text-blue-400" /> },
          { label: "With Δ >$0.50",  value: stats.withDelta,   icon: <AlertTriangle className="h-4 w-4 text-amber-400" /> },
          { label: "Critical",       value: stats.critical,    icon: <TrendingDown className="h-4 w-4 text-red-400" /> },
          { label: "Carrier Overbill Detected", value: `$${stats.totalSaved.toFixed(2)}`, icon: <DollarSign className="h-4 w-4 text-emerald-400" /> },
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

      {/* Last result card */}
      {lastResult && (
        <Card className={`border-${lastResult.analysis.severity === 'critical' ? 'red' : lastResult.analysis.severity === 'major' ? 'orange' : 'emerald'}-500/30 bg-${lastResult.analysis.severity === 'critical' ? 'red' : lastResult.analysis.severity === 'major' ? 'orange' : 'emerald'}-500/5`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Latest Reconciliation — {lastResult.reconciliation.carrierName}
              <SeverityBadge severity={lastResult.analysis.severity} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-4">
              {[
                { label: "Carrier Total",      value: `$${(lastResult.reconciliation.carrierTotal ?? 0).toFixed(4)}` },
                { label: "Reproduced Total",   value: `$${(lastResult.analysis.reproducedTotal ?? 0).toFixed(4)}` },
                { label: "Δ Carrier vs BitsAuto", value: `$${(lastResult.analysis.deltaCarrierVsReproduced ?? 0).toFixed(4)}` },
                { label: "Snapshots Compared", value: lastResult.analysis.snapshotCount.toLocaleString() },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="font-bold font-mono">{s.value}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Intelligence Recommendations</p>
              {lastResult.analysis.recommendations.length > 0
                ? lastResult.analysis.recommendations.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-blue-400" />
                      <span className="text-muted-foreground">{r}</span>
                    </div>
                  ))
                : <p className="text-sm text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />No discrepancies detected.</p>
              }
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reconciliation list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Reconciliation History</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                data-testid="input-filter-tariff"
                placeholder="Filter tariff / vendor…"
                value={filterTariff}
                onChange={e => setFilterTariff(e.target.value)}
                className="h-8 text-xs w-44"
              />
              <Input
                data-testid="input-filter-period-start"
                type="date"
                value={filterPeriodStart}
                onChange={e => setFilterPeriodStart(e.target.value)}
                title="Export period start"
                className="h-8 text-xs w-36"
              />
              <Input
                data-testid="input-filter-period-end"
                type="date"
                value={filterPeriodEnd}
                onChange={e => setFilterPeriodEnd(e.target.value)}
                title="Export period end"
                className="h-8 text-xs w-36"
              />
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger data-testid="select-filter-status" className="w-36 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["all","shadow","pending","reviewed","resolved","disputed"].map(s => (
                    <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription className="text-xs">{reconciliations.length} reconciliation(s) · Use tariff/period inputs to scope exports</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : reconciliations.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No reconciliations yet. Enter a carrier invoice to begin.</p>
              <p className="text-xs mt-1">Requires locked rating snapshots for the period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Carrier</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Carrier Total</TableHead>
                    <TableHead>Reproduced</TableHead>
                    <TableHead>Δ</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reconciliations.map(r => (
                    <TableRow
                      key={r.id}
                      data-testid={`row-reconciliation-${r.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailId(r.id)}
                    >
                      <TableCell className="font-medium text-sm">{r.carrierName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {r.periodStart ?? "—"} → {r.periodEnd ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {r.carrierTotal != null ? `$${r.carrierTotal.toFixed(4)}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {r.reproducedTotal != null ? `$${r.reproducedTotal.toFixed(4)}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {r.deltaCarrierVsReproduced != null ? (
                          <span className={Math.abs(r.deltaCarrierVsReproduced) < 0.5 ? "text-emerald-400" : Math.abs(r.deltaCarrierVsReproduced) < 5 ? "text-amber-400" : "text-red-400"}>
                            {r.deltaCarrierVsReproduced > 0 ? "+" : ""}{r.deltaCarrierVsReproduced.toFixed(4)}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <DiscrepancyTypeLabel type="shadow" />
                      </TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Report dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-400" />
              Email Reconciliation Report
            </DialogTitle>
            <DialogDescription>
              The report will be generated with your current filters and sent as an attachment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs mb-1.5 block">Recipient Email(s) *</Label>
              <Input
                data-testid="input-email-to"
                type="text"
                placeholder="alice@example.com, bob@example.com"
                value={emailForm.to}
                onChange={e => setEmailForm(f => ({ ...f, to: e.target.value }))}
              />
              {emailListError && (
                <p data-testid="text-email-error" className="text-xs text-destructive mt-1">{emailListError}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Separate multiple addresses with commas.</p>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Subject *</Label>
              <Input
                data-testid="input-email-subject"
                value={emailForm.subject}
                onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Format</Label>
                <Select value={emailForm.format} onValueChange={v => setEmailForm(f => ({ ...f, format: v as 'pdf' | 'csv' }))}>
                  <SelectTrigger data-testid="select-email-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF Report</SelectItem>
                    <SelectItem value="csv">Excel (CDR Snapshot .xlsx)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {emailForm.format === 'csv' && (
                <div>
                  <Label className="text-xs mb-1.5 block">CSV Mode</Label>
                  <Select value={emailForm.mode} onValueChange={v => setEmailForm(f => ({ ...f, mode: v as 'cdr' | 'summary' }))}>
                    <SelectTrigger data-testid="select-email-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cdr">CDR Snapshot</SelectItem>
                      <SelectItem value="summary">Summary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Message (optional)</Label>
              <Textarea
                data-testid="input-email-message"
                placeholder="Include any notes or context for the recipient…"
                rows={3}
                value={emailForm.message}
                onChange={e => setEmailForm(f => ({ ...f, message: e.target.value }))}
              />
            </div>
            {(filterTariff || filterPeriodStart || filterPeriodEnd || filterStatus !== 'all') && (
              <div className="bg-muted/30 border border-border rounded p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground">Active filters applied to attachment:</p>
                {filterTariff     && <p>Vendor / Tariff: <span className="font-mono">{filterTariff}</span></p>}
                {filterPeriodStart && <p>Period start: <span className="font-mono">{filterPeriodStart}</span></p>}
                {filterPeriodEnd   && <p>Period end: <span className="font-mono">{filterPeriodEnd}</span></p>}
                {filterStatus !== 'all' && <p>Status: <span className="font-mono">{filterStatus}</span></p>}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowEmailDialog(false)}>Cancel</Button>
              <Button
                data-testid="button-email-send"
                onClick={() => emailMutation.mutate(emailForm)}
                disabled={emailMutation.isPending || !emailForm.to || !emailForm.subject || !!emailListError}
              >
                {emailMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                  : <><Mail className="h-4 w-4 mr-2" />Send Report</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Run Carrier Reconciliation</DialogTitle>
            <DialogDescription>
              Enter carrier invoice details. BitsAuto will compare against locked immutable snapshots.
              Shadow mode — no automatic actions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Carrier Name *</Label>
                <Input
                  data-testid="input-carrier-name"
                  value={form.carrierName}
                  onChange={e => setForm(f => ({ ...f, carrierName: e.target.value }))}
                  placeholder="e.g. Tata Communications"
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Invoice Reference</Label>
                <Input
                  data-testid="input-invoice-ref"
                  value={form.invoiceRef}
                  onChange={e => setForm(f => ({ ...f, invoiceRef: e.target.value }))}
                  placeholder="INV-2026-0042"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Tariff (optional)</Label>
              <Select value={form.iTariff} onValueChange={v => setForm(f => ({ ...f, iTariff: v }))}>
                <SelectTrigger data-testid="select-recon-tariff">
                  <SelectValue placeholder="All tariffs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All tariffs</SelectItem>
                  {tariffs.map(t => (
                    <SelectItem key={String(t.iTariff)} value={String(t.iTariff)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Period Start *</Label>
                <Input
                  data-testid="input-recon-period-start"
                  type="date"
                  value={form.periodStart}
                  onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Period End *</Label>
                <Input
                  data-testid="input-recon-period-end"
                  type="date"
                  value={form.periodEnd}
                  onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Carrier Invoice Total ($) *</Label>
              <Input
                data-testid="input-carrier-total"
                type="number"
                step="0.000001"
                value={form.carrierTotal}
                onChange={e => setForm(f => ({ ...f, carrierTotal: e.target.value }))}
                placeholder="0.000000"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Notes</Label>
              <Textarea
                data-testid="input-recon-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Invoice date, currency, contact…"
                rows={2}
              />
            </div>
            <Button
              data-testid="button-confirm-run"
              className="w-full"
              onClick={() => runMutation.mutate(form)}
              disabled={runMutation.isPending || !form.carrierName || !form.periodStart || !form.periodEnd || !form.carrierTotal}
            >
              {runMutation.isPending ? "Running…" : "Run Reconciliation (Shadow Mode)"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule Report Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={open => { setShowScheduleDialog(open); if (!open) setEditingSchedule(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-violet-400" />
              {editingSchedule ? 'Edit Schedule' : 'Schedule Recurring Report'}
            </DialogTitle>
            <DialogDescription>
              {editingSchedule
                ? 'Update the settings for this recurring carrier reconciliation report.'
                : 'Configure automatic email delivery of carrier reconciliation reports. Reports are generated for the current billing period at the scheduled time.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Schedule Name</Label>
              <Input
                data-testid="input-schedule-name"
                value={scheduleForm.name}
                onChange={e => setScheduleForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Monthly Carrier Reconciliation"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Recipients (comma-separated)</Label>
              <Input
                data-testid="input-schedule-recipients"
                value={scheduleForm.recipients}
                onChange={e => setScheduleForm(f => ({ ...f, recipients: e.target.value }))}
                placeholder="finance@company.com, ops@company.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Format</Label>
                <Select value={scheduleForm.format} onValueChange={v => setScheduleForm(f => ({ ...f, format: v as any }))}>
                  <SelectTrigger data-testid="select-schedule-format"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF Report</SelectItem>
                    <SelectItem value="csv">Excel Export (.xlsx)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Frequency</Label>
                <Select value={scheduleForm.frequency} onValueChange={v => setScheduleForm(f => ({ ...f, frequency: v as any }))}>
                  <SelectTrigger data-testid="select-schedule-frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {scheduleForm.frequency === 'monthly' ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Day of Month (1–28)</Label>
                  <Input
                    data-testid="input-schedule-day-month"
                    type="number"
                    min={1}
                    max={28}
                    value={scheduleForm.dayOfMonth}
                    onChange={e => setScheduleForm(f => ({ ...f, dayOfMonth: Number(e.target.value) }))}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">Day of Week</Label>
                  <Select value={String(scheduleForm.dayOfWeek)} onValueChange={v => setScheduleForm(f => ({ ...f, dayOfWeek: Number(v) }))}>
                    <SelectTrigger data-testid="select-schedule-day-week"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                        <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Hour (UTC, 0–23)</Label>
                <Input
                  data-testid="input-schedule-hour"
                  type="number"
                  min={0}
                  max={23}
                  value={scheduleForm.cronHour}
                  onChange={e => setScheduleForm(f => ({ ...f, cronHour: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Carrier / Tariff Filter (optional)</Label>
              <Input
                data-testid="input-schedule-tariff"
                value={scheduleForm.carrierTariff}
                onChange={e => setScheduleForm(f => ({ ...f, carrierTariff: e.target.value }))}
                placeholder="Leave blank for all carriers"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowScheduleDialog(false); setEditingSchedule(null); }}>Cancel</Button>
            {editingSchedule ? (
              <Button
                data-testid="button-save-schedule"
                disabled={updateScheduleMut.isPending || !scheduleForm.name.trim() || !scheduleForm.recipients.trim()}
                onClick={() => updateScheduleMut.mutate({
                  id: editingSchedule.id,
                  name: scheduleForm.name.trim(),
                  recipients: scheduleForm.recipients.trim(),
                  format: scheduleForm.format,
                  frequency: scheduleForm.frequency,
                  dayOfMonth: scheduleForm.frequency === 'monthly' ? scheduleForm.dayOfMonth : 1,
                  dayOfWeek: scheduleForm.frequency === 'weekly' ? scheduleForm.dayOfWeek : null,
                  cronHour: scheduleForm.cronHour,
                  carrierTariff: scheduleForm.carrierTariff.trim() || null,
                })}
              >
                {updateScheduleMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Pencil className="h-4 w-4 mr-2" />}
                Save Changes
              </Button>
            ) : (
              <Button
                data-testid="button-create-schedule"
                disabled={createScheduleMut.isPending || !scheduleForm.name.trim() || !scheduleForm.recipients.trim()}
                onClick={() => createScheduleMut.mutate({
                  name: scheduleForm.name.trim(),
                  reportType: 'carrier',
                  recipients: scheduleForm.recipients.trim(),
                  format: scheduleForm.format,
                  frequency: scheduleForm.frequency,
                  dayOfMonth: scheduleForm.frequency === 'monthly' ? scheduleForm.dayOfMonth : 1,
                  dayOfWeek: scheduleForm.frequency === 'weekly' ? scheduleForm.dayOfWeek : null,
                  cronHour: scheduleForm.cronHour,
                  carrierTariff: scheduleForm.carrierTariff.trim() || null,
                  enabled: true,
                })}
              >
                {createScheduleMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Create Schedule
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scheduled Reports Panel */}
      {(schedules.length > 0 || schedulesLoading) && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-violet-400" />
              <h3 className="font-semibold text-sm">Carrier Reconciliation Schedules</h3>
              <Badge variant="outline" className="text-xs">{schedules.length}</Badge>
            </div>
            <Button variant="outline" size="sm" data-testid="button-add-schedule" onClick={() => setShowScheduleDialog(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Schedule
            </Button>
          </div>
          <div className="px-6 py-4 space-y-2">
            {schedulesLoading && <p className="text-xs text-muted-foreground">Loading schedules…</p>}
            {schedules.map(s => (
              <div key={s.id} data-testid={`row-schedule-${s.id}`} className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{s.name}</span>
                    <Badge variant="outline" className="text-[11px] text-violet-400 border-violet-500/30">
                      {s.frequency === 'monthly' ? `Monthly day ${s.dayOfMonth}` : `Weekly ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][s.dayOfWeek ?? 1]}`}
                    </Badge>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground uppercase">{s.format}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground">{s.cronHour}:00 UTC</span>
                    {s.carrierTariff && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">tariff: {s.carrierTariff}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.recipients}</p>
                  {s.lastSentAt && <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1"><Clock className="h-3 w-3" />Last sent: {new Date(s.lastSentAt).toLocaleString()}</p>}
                  {s.nextDueAt && <p className="text-[10px] text-muted-foreground/60 mt-0.5">Next: {new Date(s.nextDueAt).toLocaleString()}</p>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                  <Button
                    variant="ghost" size="sm" title="Edit schedule"
                    data-testid={`button-edit-schedule-${s.id}`}
                    onClick={() => {
                      setEditingSchedule(s);
                      setScheduleForm({
                        name: s.name,
                        recipients: s.recipients,
                        format: s.format as 'pdf' | 'csv',
                        frequency: s.frequency as 'monthly' | 'weekly',
                        dayOfMonth: s.dayOfMonth ?? 1,
                        dayOfWeek: s.dayOfWeek ?? 1,
                        cronHour: s.cronHour,
                        carrierTariff: s.carrierTariff ?? '',
                      });
                      setShowScheduleDialog(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 text-yellow-400" />
                  </Button>
                  <Button
                    variant="ghost" size="sm" title="Send now"
                    data-testid={`button-send-now-${s.id}`}
                    onClick={() => sendNowMut.mutate(s.id)}
                    disabled={sendNowMut.isPending}
                  >
                    <Send className="h-3.5 w-3.5 text-blue-400" />
                  </Button>
                  <Button
                    variant="ghost" size="sm" title={s.enabled ? 'Disable' : 'Enable'}
                    data-testid={`button-toggle-schedule-${s.id}`}
                    onClick={() => toggleScheduleMut.mutate({ id: s.id, enabled: !s.enabled })}
                  >
                    {s.enabled ? <ToggleRight className="h-3.5 w-3.5 text-emerald-400" /> : <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                  </Button>
                  <Button
                    variant="ghost" size="sm" title="Delete"
                    data-testid={`button-delete-schedule-${s.id}`}
                    onClick={() => deleteScheduleMut.mutate(s.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={detailId != null} onOpenChange={open => !open && setDetailId(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Reconciliation #{detailId}
            </DialogTitle>
            {detail && <StatusBadge status={detail.status} />}
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Carrier</p><p className="font-semibold">{detail.carrierName}</p></div>
                <div><p className="text-xs text-muted-foreground">Invoice Ref</p><p className="font-mono">{detail.invoiceRef ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Period</p><p className="font-mono text-xs">{detail.periodStart} → {detail.periodEnd}</p></div>
                <div><p className="text-xs text-muted-foreground">Tariff</p><p>{detail.iTariff ?? "All"}</p></div>
              </div>
              <div className="bg-muted/20 rounded border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cost Comparison</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ["Carrier Total",     `$${(detail.carrierTotal ?? 0).toFixed(6)}`],
                    ["Sippy Total",       `$${(detail.sippyTotal ?? 0).toFixed(6)}`],
                    ["Reproduced Total",  `$${(detail.reproducedTotal ?? 0).toFixed(6)}`],
                    ["Snapshot Total",    `$${(detail.snapshotTotal ?? 0).toFixed(6)}`],
                    ["Δ Carrier vs BitsAuto", `$${(detail.deltaCarrierVsReproduced ?? 0).toFixed(6)}`],
                    ["Δ Carrier vs Sippy",    `$${(detail.deltaCarrierVsSippy ?? 0).toFixed(6)}`],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="text-muted-foreground">{label}</p>
                      <p className="font-mono font-semibold">{val}</p>
                    </div>
                  ))}
                </div>
              </div>
              {detail.notes && (
                <div><p className="text-xs text-muted-foreground">Notes</p><p className="text-muted-foreground">{detail.notes}</p></div>
              )}
            </div>
          )}
          <DialogFooter className="pt-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-detail-download"
                  disabled={exportingDetail !== null || !detail}
                >
                  {exportingDetail ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Download Report
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="button-detail-download-full-csv"
                  onClick={() => handleDetailExport('full-csv')}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2 text-blue-400" />
                  Full Report Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="button-detail-download-csv"
                  onClick={() => handleDetailExport('csv')}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-400" />
                  CDR Snapshot Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="button-detail-download-pdf"
                  onClick={() => handleDetailExport('pdf')}
                >
                  <FileText className="h-4 w-4 mr-2 text-red-400" />
                  PDF Report
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Add schedule prompt when none exist */}
      {!schedulesLoading && schedules.length === 0 && (
        <div className="flex items-center justify-between p-4 rounded-lg border border-dashed border-violet-500/30 bg-violet-500/5">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-violet-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">No recurring report schedules</p>
              <p className="text-xs text-muted-foreground">Set up automatic email delivery so finance teams receive reconciliation reports without logging in.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" data-testid="button-add-first-schedule" onClick={() => setShowScheduleDialog(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Schedule Report
          </Button>
        </div>
      )}

      {/* ── Email Delivery Audit Log ──────────────────────────────────────── */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4 text-blue-400" />
            Email Delivery Audit Log
          </CardTitle>
          <CardDescription className="text-xs">Last 100 reconciliation report emails sent from this platform</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {emailLogs.filter(l => l.reportType === 'carrier').length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 pb-4">No emails sent yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Sent At</TableHead>
                  <TableHead className="text-xs">Recipient</TableHead>
                  <TableHead className="text-xs">Format</TableHead>
                  <TableHead className="text-xs">Sent By</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Filename</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emailLogs.filter(l => l.reportType === 'carrier').map(log => (
                  <TableRow key={log.id} data-testid={`row-email-log-${log.id}`}>
                    <TableCell className="text-xs font-mono">
                      {new Date(log.sentAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">{log.recipientEmail}</TableCell>
                    <TableCell className="text-xs uppercase">{log.format}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.senderName ?? log.senderUserId ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {log.status === 'sent' ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />sent
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1" title={log.errorMessage ?? ''}>
                          <AlertTriangle className="h-3 w-3" />failed
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {log.filename ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
