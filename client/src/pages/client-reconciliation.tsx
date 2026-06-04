import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, RefreshCw, Search,
  Upload, Users, DollarSign, Info, TrendingDown, ThumbsUp, ShieldAlert,
  Download, FileText, Loader2, FileSpreadsheet, FileDown, Mail, History,
  Calendar, Trash2, Plus, ToggleLeft, ToggleRight, Send, Pencil,
  Eye, CalendarDays, Hash, StickyNote, GitBranch,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

interface ReconRow {
  id:                  number;
  billingPeriod:       string;
  version:             number;
  parentId?:           number;
  clientAccountId?:    string;
  clientName:          string;
  clientDurationSec?:  number;
  clientAmountUsd?:    number;
  clientCalls?:        number;
  bitsautoDurationSec?: number;
  bitsautoAmountUsd?:  number;
  bitsautoCalls?:      number;
  dmrDurationSec?:     number;
  dmrAmountUsd?:       number;
  deltaDurationSec?:   number;
  deltaAmountUsd?:     number;
  deltaPct?:           number;
  discrepancyType:     string;
  severity:            string;
  status:              string;
  notes?:              string;
  createdAt:           string;
}

interface Summary {
  total: number; clean: number; low: number; medium: number;
  high: number; critical: number; reconciled: number; pending: number; disputed: number;
}

const SEVERITY_CFG: Record<string, { label: string; color: string; icon: any; rowBg: string }> = {
  clean:    { label: 'Clean',    color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', icon: CheckCircle2,  rowBg: '' },
  low:      { label: 'Low',      color: 'text-sky-400 bg-sky-400/10 border-sky-400/30',             icon: Info,          rowBg: '' },
  medium:   { label: 'Medium',   color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',       icon: AlertTriangle, rowBg: 'bg-amber-500/5' },
  high:     { label: 'High',     color: 'text-orange-400 bg-orange-400/10 border-orange-400/30',    icon: TrendingDown,  rowBg: 'bg-orange-500/5' },
  critical: { label: 'Critical', color: 'text-red-400 bg-red-400/10 border-red-400/30',             icon: XCircle,       rowBg: 'bg-red-500/8' },
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  pending:     { label: 'Pending',     color: 'text-slate-400 bg-slate-400/10 border-slate-400/30' },
  in_review:   { label: 'In Review',   color: 'text-sky-400 bg-sky-400/10 border-sky-400/30' },
  reconciled:  { label: 'Reconciled',  color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  disputed:    { label: 'Disputed',    color: 'text-red-400 bg-red-400/10 border-red-400/30' },
  approved:    { label: 'Approved',    color: 'text-purple-400 bg-purple-400/10 border-purple-400/30' },
};

const DISCREPANCY_LABELS: Record<string, string> = {
  exact_match:       'Exact Match',
  duration_drift:    'Duration Drift',
  amount_drift:      'Amount Drift',
  both_drift:        'Both Drift',
  no_client_data:    'No Client Data',
  no_bitsauto_data:  'No BitsAuto Data',
};

function fmtMin(sec?: number | null): string {
  if (sec == null) return '—';
  return `${Math.round(sec / 60).toLocaleString()} min`;
}
function fmtUsd(v?: number | null): string {
  if (v == null) return '—';
  return `$${v.toFixed(2)}`;
}
function fmtPct(v?: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}${abs.toFixed(1)}%`;
}

function downloadRowXlsx(row: ReconRow) {
  import('xlsx').then(XLSX => {
    const fmtN = (v: number | null | undefined, d = 2) => v == null ? '' : +v.toFixed(d);
    const headers = [
      'ID', 'Billing Period', 'Version', 'Client Name', 'Account ID',
      'Client Duration (min)', 'Client Amount (USD)', 'Client Calls',
      'BA Duration (min)', 'BA Amount (USD)', 'BA Calls',
      'DMR Duration (min)', 'DMR Amount (USD)',
      'Δ Duration (min)', 'Δ Amount (USD)', 'Δ %',
      'Discrepancy Type', 'Severity', 'Status', 'Notes',
    ];
    const values = [
      row.id, row.billingPeriod, row.version ?? 1, row.clientName, row.clientAccountId ?? '',
      fmtN(row.clientDurationSec != null ? row.clientDurationSec / 60 : null),
      fmtN(row.clientAmountUsd, 4), row.clientCalls ?? '',
      fmtN(row.bitsautoDurationSec != null ? row.bitsautoDurationSec / 60 : null),
      fmtN(row.bitsautoAmountUsd, 4), row.bitsautoCalls ?? '',
      fmtN(row.dmrDurationSec != null ? row.dmrDurationSec / 60 : null), fmtN(row.dmrAmountUsd, 4),
      fmtN(row.deltaDurationSec != null ? row.deltaDurationSec / 60 : null),
      fmtN(row.deltaAmountUsd, 4), fmtN(row.deltaPct),
      row.discrepancyType, row.severity, row.status, row.notes ?? '',
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, values]);
    ws['!cols'] = headers.map((h, i) => ({ wch: Math.min(Math.max(h.length + 2, String(values[i] ?? '').length + 2), 40) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const clientSlug = row.clientName.replace(/\s+/g, '-');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `recon-${clientSlug}-${row.billingPeriod}.xlsx`;
    a.click();
  });
}

const importSchema = z.object({
  billingPeriod:    z.string().regex(/^\d{4}-\d{2}$/, 'Format: YYYY-MM'),
  clientName:       z.string().min(1, 'Required'),
  clientAccountId:  z.string().optional(),
  durationMinutes:  z.coerce.number().min(0),
  amountUsd:        z.coerce.number().min(0),
  calls:            z.coerce.number().optional(),
  notes:            z.string().optional(),
});
type ImportForm = z.infer<typeof importSchema>;

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

interface SippyAcct {
  iAccount: number;
  username: string;
  description: string;
}

function ClientDetailDialog({ row, open, onClose }: {
  row: ReconRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: allVersions = [] } = useQuery<ReconRow[]>({
    queryKey: ["/api/client-reconciliation/versions", row?.billingPeriod, row?.clientName],
    queryFn: () =>
      apiRequest("GET", `/api/client-reconciliation?period=${row!.billingPeriod}`)
        .then(r => r.json())
        .then((rows: ReconRow[]) =>
          rows.filter(r => r.clientName === row!.clientName).sort((a, b) => b.version - a.version)
        ),
    enabled: open && row !== null,
    staleTime: 30_000,
  });

  if (!row) return null;

  const sevcfg = SEVERITY_CFG[row.severity] ?? SEVERITY_CFG.low;
  const stcfg  = STATUS_CFG[row.status]     ?? STATUS_CFG.pending;
  const SevIcon = sevcfg.icon;

  const versions = allVersions;

  function FieldRow({ label, value, mono = false, highlight }: {
    label: string; value: string; mono?: boolean; highlight?: string;
  }) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs text-muted-foreground w-40 flex-shrink-0">{label}</span>
        <span className={`text-sm font-medium text-right ${mono ? 'font-mono' : ''} ${highlight ?? ''}`}>{value}</span>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-client-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            {row.clientName}
          </DialogTitle>
          <DialogDescription>
            Client reconciliation detail for billing period{' '}
            <span className="font-semibold text-foreground font-mono">{row.billingPeriod}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Identifiers */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5" /> Record
            </p>
            <div className="divide-y divide-border/40">
              <FieldRow label="Billing Period" value={row.billingPeriod} mono />
              {row.clientAccountId && <FieldRow label="Account ID" value={row.clientAccountId} mono />}
              <FieldRow label="Version" value={`v${row.version}`} />
              <FieldRow label="Discrepancy Type" value={DISCREPANCY_LABELS[row.discrepancyType] ?? row.discrepancyType} />
            </div>
          </div>

          <Separator />

          {/* Client Reported */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Client Reported
            </p>
            <div className="divide-y divide-border/40">
              <FieldRow label="Duration" value={fmtMin(row.clientDurationSec)} />
              <FieldRow label="Amount" value={fmtUsd(row.clientAmountUsd)} />
              <FieldRow label="Calls" value={row.clientCalls != null ? row.clientCalls.toLocaleString() : '—'} />
            </div>
          </div>

          <Separator />

          {/* BitsAuto Invoice */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> BitsAuto Invoice
            </p>
            <div className="divide-y divide-border/40">
              <FieldRow label="Duration" value={fmtMin(row.bitsautoDurationSec)} />
              <FieldRow label="Amount" value={fmtUsd(row.bitsautoAmountUsd)} />
              <FieldRow label="Calls" value={row.bitsautoCalls != null ? row.bitsautoCalls.toLocaleString() : '—'} />
            </div>
          </div>

          <Separator />

          {/* DMR Sippy */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" /> DMR (Sippy Arbiter)
            </p>
            <div className="divide-y divide-border/40">
              <FieldRow label="Duration" value={fmtMin(row.dmrDurationSec)} />
              <FieldRow label="Amount" value={fmtUsd(row.dmrAmountUsd)} />
            </div>
          </div>

          <Separator />

          {/* Deltas & Classification */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
              <TrendingDown className="h-3.5 w-3.5" /> Delta & Classification
            </p>
            <div className="divide-y divide-border/40">
              <FieldRow
                label="Delta Duration"
                value={fmtMin(row.deltaDurationSec)}
                highlight={row.deltaDurationSec ? 'text-amber-400' : ''}
              />
              <FieldRow
                label="Delta Amount"
                value={fmtUsd(row.deltaAmountUsd)}
                highlight={row.deltaAmountUsd ? 'text-amber-400' : ''}
              />
              <FieldRow
                label="Delta %"
                value={fmtPct(row.deltaPct)}
                highlight={row.deltaPct != null && Math.abs(row.deltaPct) >= 2 ? 'text-amber-400' : 'text-emerald-400'}
              />
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-muted-foreground w-40 flex-shrink-0">Severity</span>
                <Badge variant="outline" className={`text-xs ${sevcfg.color}`}>
                  <SevIcon className="h-3 w-3 mr-1" />
                  {sevcfg.label}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-muted-foreground w-40 flex-shrink-0">Status</span>
                <Badge variant="outline" className={`text-xs ${stcfg.color}`}>
                  {stcfg.label}
                </Badge>
              </div>
            </div>
          </div>

          {/* Notes */}
          {row.notes && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
                  <StickyNote className="h-3.5 w-3.5" /> Notes
                </p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/30 rounded p-3">
                  {row.notes}
                </p>
              </div>
            </>
          )}

          {/* Version History */}
          {versions.length > 1 && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5" /> Version History ({versions.length})
                </p>
                <div className="space-y-1">
                  {versions.map(v => {
                    const vsev = SEVERITY_CFG[v.severity] ?? SEVERITY_CFG.low;
                    const vst  = STATUS_CFG[v.status]    ?? STATUS_CFG.pending;
                    const isCurrent = v.id === row.id;
                    return (
                      <div
                        key={v.id}
                        data-testid={`version-row-${v.id}`}
                        className={`flex items-center justify-between rounded px-3 py-2 text-xs ${isCurrent ? 'bg-primary/10 border border-primary/30' : 'bg-muted/30'}`}
                      >
                        <span className="font-mono font-medium">v{v.version}</span>
                        <span className="text-muted-foreground">{fmtUsd(v.deltaAmountUsd)} delta</span>
                        <Badge variant="outline" className={`text-xs ${vsev.color}`}>{vsev.label}</Badge>
                        <Badge variant="outline" className={`text-xs ${vst.color}`}>{vst.label}</Badge>
                        {isCurrent && <span className="text-primary font-medium">current</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} data-testid="button-detail-close">Close</Button>
          <Button
            variant="outline"
            onClick={() => downloadRowXlsx(row)}
            data-testid="button-detail-download-csv"
            className="gap-2"
          >
            <FileDown className="h-4 w-4 text-sky-400" />
            Download Excel (.xlsx)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientReconciliationPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [activeTab, setActiveTab] = useState<'discrepancies' | 'all'>('discrepancies');
  const [filter, setFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [selectedRow, setSelectedRow] = useState<ReconRow | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailForm, setEmailForm] = useState({
    to: '', subject: 'Client Reconciliation Report', message: '', format: 'pdf' as 'pdf' | 'csv',
  });

  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ReconSchedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    name: 'Monthly Client Reconciliation',
    recipients: '',
    format: 'pdf' as 'pdf' | 'csv',
    frequency: 'monthly' as 'monthly' | 'weekly',
    dayOfMonth: 1,
    dayOfWeek: 1,
    cronHour: 8,
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
      apiRequest("POST", "/api/client-reconciliation/export/email", {
        ...data,
        period,
        excludeClean: activeTab === 'discrepancies',
      }).then(r => r.json()),
    onSuccess: (data: any) => {
      const recipients = parseEmailList(emailForm.to);
      const recipientDesc = recipients.length > 1 ? `${recipients.length} recipients` : emailForm.to.trim();
      toast({ title: 'Report emailed', description: `Sent ${data.filename} to ${recipientDesc}` });
      setShowEmailDialog(false);
    },
    onError: (err: any) => {
      toast({ title: 'Email failed', description: err.message, variant: 'destructive' });
    },
  });

  interface ReconSchedule { id: number; name: string; reportType: string; recipients: string; format: string; frequency: string; dayOfMonth: number | null; dayOfWeek: number | null; cronHour: number; carrierTariff: string | null; enabled: boolean; lastSentAt: string | null; nextDueAt: string | null; createdAt: string; }
  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<ReconSchedule[]>({
    queryKey: ["/api/reconciliation-report-schedules"],
    select: (data) => data.filter(s => s.reportType === 'client'),
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

  async function handleExport(type: 'csv' | 'pdf') {
    setExporting(type);
    try {
      const params = new URLSearchParams({ period });
      if (activeTab === 'discrepancies') params.set('excludeClean', '1');
      const baseUrl = `/api/client-reconciliation/export/${type}`;
      const url = `${baseUrl}?${params}`;
      const res = await fetch(url);
      const ct = res.headers.get('content-type') ?? '';

      if (ct.includes('application/json')) {
        const j = await res.json();
        if (j.large) {
          const dl = await fetch(`/api/client-reconciliation/export/download/${j.token}`);
          const blob = await dl.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = j.filename;
          a.click();
          toast({ title: `Export ready — ${(j.rowCount ?? '').toLocaleString()} rows` });
        }
      } else {
        const blob = await res.blob();
        const cd = res.headers.get('content-disposition') ?? '';
        const fn = cd.match(/filename="([^"]+)"/)?.[1] ?? `client-reconciliation.${type}`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fn;
        a.click();
        toast({ title: type === 'csv' ? 'Excel exported' : 'PDF report exported' });
      }
    } catch (e: any) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    } finally {
      setExporting(null);
    }
  }

  const { data: emailLogs = [] } = useQuery<ReconEmailLog[]>({
    queryKey: ["/api/reconciliation/email-log"],
    refetchInterval: 30_000,
  });

  const { data: sippyAccounts = [] } = useQuery<SippyAcct[]>({
    queryKey: ["/api/sippy/accounts"],
    queryFn: () => apiRequest("GET", "/api/sippy/accounts").then(r => r.json()).then(d => Array.isArray(d.accounts) ? d.accounts : []),
    staleTime: 5 * 60 * 1000,
  });

  const form = useForm<ImportForm>({
    resolver: zodResolver(importSchema),
    defaultValues: {
      billingPeriod: period,
      clientName: '',
      clientAccountId: '',
      durationMinutes: 0,
      amountUsd: 0,
      calls: undefined,
      notes: '',
    },
  });

  const { data: rows = [], isLoading } = useQuery<ReconRow[]>({
    queryKey: ["/api/client-reconciliation", period],
    queryFn: () => apiRequest("GET", `/api/client-reconciliation?period=${period}&latestOnly=true`).then(r => r.json()),
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ["/api/client-reconciliation/summary", period],
    queryFn: () => apiRequest("GET", `/api/client-reconciliation/summary?period=${period}`).then(r => r.json()),
  });

  const importMutation = useMutation({
    mutationFn: (data: ImportForm) => apiRequest("POST", "/api/client-reconciliation/import", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-reconciliation"] });
      toast({ title: "Client data imported", description: "Reconciliation comparison complete" });
      setShowImport(false);
      form.reset();
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const recalcMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/client-reconciliation/${id}/recalculate`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-reconciliation"] });
      toast({ title: "Recalculated", description: "New reconciliation version created" });
    },
    onError: (err: any) => toast({ title: "Recalculate failed", description: err.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/client-reconciliation/${id}`, { status }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/client-reconciliation"] }),
    onError: (err: any) => toast({ title: "Status update failed", description: err.message, variant: "destructive" }),
  });

  const discrepancies = rows.filter(r => r.severity !== 'clean');
  const filterRows = (arr: ReconRow[]) => {
    if (!filter) return arr;
    const q = filter.toLowerCase();
    return arr.filter(r => r.clientName.toLowerCase().includes(q) || (r.clientAccountId ?? '').toLowerCase().includes(q));
  };

  const ReconTable = ({ rows: tableRows }: { rows: ReconRow[] }) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="text-center" colSpan={2}>Client Reported</TableHead>
            <TableHead className="text-center" colSpan={2}>BitsAuto Invoice</TableHead>
            <TableHead className="text-center" colSpan={2}>DMR (Sippy)</TableHead>
            <TableHead>Delta</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead></TableHead>
          </TableRow>
          <TableRow className="text-xs text-muted-foreground">
            <TableHead></TableHead>
            <TableHead></TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Amt %</TableHead>
            <TableHead></TableHead>
            <TableHead></TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tableRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                {isLoading ? 'Loading…' : 'No records for this period. Import client billing data to begin reconciliation.'}
              </TableCell>
            </TableRow>
          )}
          {tableRows.map(row => {
            const sevcfg = SEVERITY_CFG[row.severity] ?? SEVERITY_CFG.low;
            const stcfg  = STATUS_CFG[row.status]     ?? STATUS_CFG.pending;
            const SevIcon = sevcfg.icon;
            const hasDrift = row.severity !== 'clean';
            return (
              <TableRow
                key={row.id}
                className={`${sevcfg.rowBg} cursor-pointer hover:bg-muted/30 transition-colors`}
                data-testid={`row-recon-${row.id}`}
                onClick={() => setSelectedRow(row)}
              >
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{row.clientName}</span>
                    {row.clientAccountId && (
                      <span className="text-xs text-muted-foreground font-mono">{row.clientAccountId}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm font-mono">{row.billingPeriod}</TableCell>
                <TableCell className="text-sm tabular-nums">{fmtMin(row.clientDurationSec)}</TableCell>
                <TableCell className="text-sm tabular-nums">{fmtUsd(row.clientAmountUsd)}</TableCell>
                <TableCell className="text-sm tabular-nums">{fmtMin(row.bitsautoDurationSec)}</TableCell>
                <TableCell className="text-sm tabular-nums">{fmtUsd(row.bitsautoAmountUsd)}</TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">{fmtMin(row.dmrDurationSec)}</TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">{fmtUsd(row.dmrAmountUsd)}</TableCell>
                <TableCell>
                  {row.deltaPct != null ? (
                    <span className={Math.abs(row.deltaPct) < 2 ? 'text-emerald-400' : hasDrift ? 'text-amber-400' : 'text-muted-foreground'}>
                      {fmtPct(row.deltaPct)}
                    </span>
                  ) : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs ${sevcfg.color}`}>
                    <SevIcon className="h-3 w-3 mr-1" />
                    {sevcfg.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs ${stcfg.color}`}>
                    {stcfg.label}
                  </Badge>
                </TableCell>
                <TableCell onClick={e => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <Button
                      data-testid={`button-recalc-recon-${row.id}`}
                      variant="ghost" size="sm"
                      onClick={() => recalcMutation.mutate(row.id)}
                      title="Recalculate"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    {row.status === 'pending' && (
                      <Button
                        data-testid={`button-approve-recon-${row.id}`}
                        variant="ghost" size="sm"
                        onClick={() => statusMutation.mutate({ id: row.id, status: 'approved' })}
                        title="Approve"
                      >
                        <ThumbsUp className="h-3.5 w-3.5 text-emerald-400" />
                      </Button>
                    )}
                    {(row.status === 'pending' || row.status === 'in_review') && hasDrift && (
                      <Button
                        data-testid={`button-dispute-recon-${row.id}`}
                        variant="ghost" size="sm"
                        onClick={() => statusMutation.mutate({ id: row.id, status: 'disputed' })}
                        title="Mark Disputed"
                      >
                        <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    )}
                    <Button
                      data-testid={`button-download-recon-${row.id}`}
                      variant="ghost" size="sm"
                      onClick={() => downloadRowXlsx(row)}
                      title="Download Excel for this record"
                    >
                      <FileDown className="h-3.5 w-3.5 text-sky-400" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Client Revenue Reconciliation
          </h1>
          <p className="text-muted-foreground mt-1">
            Compare client-submitted billing against BitsAuto invoice and Sippy operational truth
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            data-testid="input-period"
            type="month"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="w-44"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-export-dropdown" disabled={exporting !== null}>
                {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="button-export-csv"
                onClick={() => handleExport('csv')}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-400" />
                Export Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="button-export-pdf"
                onClick={() => handleExport('pdf')}
              >
                <FileText className="h-4 w-4 mr-2 text-red-400" />
                Export PDF
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
          <Button
            data-testid="button-import-open"
            onClick={() => {
              form.setValue('billingPeriod', period);
              setShowImport(true);
            }}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Client Data
          </Button>
        </div>
      </div>

      {/* Bilateral finance notice */}
      <div className="flex items-start gap-3 bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
        <Info className="h-5 w-5 text-purple-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-purple-400">Bilateral Finance Triangulation</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Vendor → BitsAuto is covered by Carrier Reconciliation.
            BitsAuto → Customer is this module.
            Together they complete full telecom finance triangulation.
            DMR serves as the neutral Sippy arbiter when client and invoice figures disagree.
          </p>
        </div>
      </div>

      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Clean / Reconciled', value: summary.reconciled, icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />, color: 'text-emerald-400' },
            { label: 'Pending Review',     value: summary.pending,    icon: <Clock className="h-4 w-4 text-amber-400" />,         color: 'text-amber-400'  },
            { label: 'Disputed',           value: summary.disputed,   icon: <ShieldAlert className="h-4 w-4 text-red-400" />,     color: 'text-red-400'    },
            { label: 'Critical Drift',     value: summary.critical,   icon: <XCircle className="h-4 w-4 text-red-500" />,         color: 'text-red-500'    },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                  {s.icon}
                </div>
                <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Finance triangulation legend */}
      <Card className="border-dashed">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-6 flex-wrap text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Comparison hierarchy:</span>
            <span><span className="text-blue-400 font-semibold">Client says</span> → primary dispute trigger</span>
            <span><span className="text-emerald-400 font-semibold">BitsAuto invoice</span> → our computed figure</span>
            <span><span className="text-purple-400 font-semibold">DMR (Sippy)</span> → neutral arbiter</span>
            <span className="italic">If BitsAuto ≈ DMR but client disagrees → client-side data issue</span>
            <span className="italic">If BitsAuto ≠ DMR → investigate invoice calculation</span>
          </div>
        </CardContent>
      </Card>

      {/* Main table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base">{period} — {rows.length} client{rows.length !== 1 ? 's' : ''}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {discrepancies.length} discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} requiring attention
              </CardDescription>
            </div>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                data-testid="input-filter"
                placeholder="Filter by client or ID…"
                className="pl-8 h-8 text-sm"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'discrepancies' | 'all')}>
            <div className="px-4 pt-0 pb-0">
              <TabsList className="h-8 mb-2">
                <TabsTrigger value="discrepancies" className="text-xs" data-testid="tab-discrepancies">
                  Discrepancies Only
                  {discrepancies.length > 0 && (
                    <Badge className="ml-1.5 h-4 text-xs bg-red-500/20 text-red-400 border-red-500/30">
                      {discrepancies.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs" data-testid="tab-all">
                  All Clients ({rows.length})
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="discrepancies" className="mt-0">
              <ReconTable rows={filterRows(discrepancies)} />
            </TabsContent>
            <TabsContent value="all" className="mt-0">
              <ReconTable rows={filterRows(rows)} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Client Detail Dialog */}
      <ClientDetailDialog
        row={selectedRow}
        open={selectedRow !== null}
        onClose={() => setSelectedRow(null)}
      />

      {/* Email Report dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-400" />
              Email Reconciliation Report
            </DialogTitle>
            <DialogDescription>
              The report for <span className="font-semibold text-foreground">{period}</span> will be generated and sent as an attachment.
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
            <div>
              <Label className="text-xs mb-1.5 block">Format</Label>
              <Select value={emailForm.format} onValueChange={v => setEmailForm(f => ({ ...f, format: v as 'pdf' | 'csv' }))}>
                <SelectTrigger data-testid="select-email-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF Report</SelectItem>
                  <SelectItem value="csv">Excel (.xlsx)</SelectItem>
                </SelectContent>
              </Select>
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
            <DialogFooter>
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
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Client Billing Data</DialogTitle>
            <DialogDescription>
              Enter the figures the client reported for the billing period. BitsAuto will compare
              these against the invoice and DMR automatically.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(data => importMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="billingPeriod" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing Period</FormLabel>
                    <FormControl>
                      <Input data-testid="input-billing-period" type="month" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="clientAccountId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account ID (optional)</FormLabel>
                    <FormControl>
                      <Input data-testid="input-account-id" placeholder="e.g. ACC-1234" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="clientName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Name</FormLabel>
                  {sippyAccounts.length > 0 ? (
                    <Select
                      value={field.value}
                      onValueChange={v => {
                        field.onChange(v);
                        const acct = sippyAccounts.find(a => a.username === v);
                        if (acct) form.setValue('clientAccountId', String(acct.iAccount));
                      }}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-client-name">
                          <SelectValue placeholder="Select Sippy account…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {sippyAccounts.map(a => (
                          <SelectItem key={a.iAccount} value={a.username}>
                            {a.username}{a.description ? ` — ${a.description}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <FormControl>
                      <Input data-testid="input-client-name" placeholder="Acme Telecom Ltd" {...field} />
                    </FormControl>
                  )}
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-3 gap-3">
                <FormField control={form.control} name="durationMinutes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (min)</FormLabel>
                    <FormControl>
                      <Input data-testid="input-duration" type="number" step="1" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amountUsd" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (USD)</FormLabel>
                    <FormControl>
                      <Input data-testid="input-amount" type="number" step="0.01" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="calls" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Calls</FormLabel>
                    <FormControl>
                      <Input data-testid="input-calls" type="number" step="1" min="0" placeholder="opt." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea data-testid="input-notes" placeholder="Context for this import…" rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowImport(false)}>Cancel</Button>
                <Button data-testid="button-import-submit" type="submit" disabled={importMutation.isPending}>
                  {importMutation.isPending ? 'Importing…' : 'Import & Compare'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
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
                ? 'Update the settings for this recurring client reconciliation report.'
                : 'Configure automatic email delivery of client reconciliation reports. Reports are generated for the active billing period at the scheduled time.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Schedule Name</Label>
              <Input
                data-testid="input-schedule-name"
                value={scheduleForm.name}
                onChange={e => setScheduleForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Monthly Client Reconciliation"
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
                  reportType: 'client',
                  recipients: scheduleForm.recipients.trim(),
                  format: scheduleForm.format,
                  frequency: scheduleForm.frequency,
                  dayOfMonth: scheduleForm.frequency === 'monthly' ? scheduleForm.dayOfMonth : 1,
                  dayOfWeek: scheduleForm.frequency === 'weekly' ? scheduleForm.dayOfWeek : null,
                  cronHour: scheduleForm.cronHour,
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
              <h3 className="font-semibold text-sm">Client Reconciliation Schedules</h3>
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
          <CardDescription className="text-xs">Last 100 client reconciliation report emails sent from this platform</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {emailLogs.filter(l => l.reportType === 'client').length === 0 ? (
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
                {emailLogs.filter(l => l.reportType === 'client').map(log => (
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
