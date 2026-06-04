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
  Download, FileText, Loader2, FileSpreadsheet, FileDown, Mail,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function downloadRowCsv(row: ReconRow) {
  const headers = [
    'id', 'billing_period', 'version', 'client_name', 'client_account_id',
    'client_duration_min', 'client_amount_usd', 'client_calls',
    'bitsauto_duration_min', 'bitsauto_amount_usd', 'bitsauto_calls',
    'dmr_duration_min', 'dmr_amount_usd',
    'delta_duration_min', 'delta_amount_usd', 'delta_pct',
    'discrepancy_type', 'severity', 'status', 'notes',
  ];
  const esc = (v: string | null | undefined) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmtN = (v: number | null | undefined, d = 2) => v == null ? '' : v.toFixed(d);
  const values = [
    String(row.id),
    esc(row.billingPeriod),
    String(row.version ?? 1),
    esc(row.clientName),
    esc(row.clientAccountId ?? ''),
    fmtN(row.clientDurationSec != null ? row.clientDurationSec / 60 : null),
    fmtN(row.clientAmountUsd, 4),
    String(row.clientCalls ?? ''),
    fmtN(row.bitsautoDurationSec != null ? row.bitsautoDurationSec / 60 : null),
    fmtN(row.bitsautoAmountUsd, 4),
    String(row.bitsautoCalls ?? ''),
    fmtN(row.dmrDurationSec != null ? row.dmrDurationSec / 60 : null),
    fmtN(row.dmrAmountUsd, 4),
    fmtN(row.deltaDurationSec != null ? row.deltaDurationSec / 60 : null),
    fmtN(row.deltaAmountUsd, 4),
    fmtN(row.deltaPct),
    esc(row.discrepancyType),
    esc(row.severity),
    esc(row.status),
    esc(row.notes ?? ''),
  ];
  const csv = [headers.join(','), values.join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const client = row.clientName.replace(/\s+/g, '-');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `recon-${client}-${row.billingPeriod}.csv`;
  a.click();
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

interface SippyAcct {
  iAccount: number;
  username: string;
  description: string;
}

export default function ClientReconciliationPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [filter, setFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailForm, setEmailForm] = useState({
    to: '', subject: 'Client Reconciliation Report', message: '', format: 'pdf' as 'pdf' | 'csv',
  });

  const emailMutation = useMutation({
    mutationFn: (data: typeof emailForm) =>
      apiRequest("POST", "/api/client-reconciliation/export/email", {
        ...data,
        period,
      }).then(r => r.json()),
    onSuccess: (data: any) => {
      toast({ title: 'Report emailed', description: `Sent ${data.filename} to ${emailForm.to}` });
      setShowEmailDialog(false);
    },
    onError: (err: any) => {
      toast({ title: 'Email failed', description: err.message, variant: 'destructive' });
    },
  });

  async function handleExport(type: 'csv' | 'pdf') {
    setExporting(type);
    try {
      const params = new URLSearchParams({ period });
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
        toast({ title: type === 'csv' ? 'CSV exported' : 'PDF report exported' });
      }
    } catch (e: any) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    } finally {
      setExporting(null);
    }
  }

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
              <TableRow key={row.id} className={sevcfg.rowBg} data-testid={`row-recon-${row.id}`}>
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
                <TableCell>
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
                      onClick={() => downloadRowCsv(row)}
                      title="Download CSV for this record"
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
                Export CSV
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
          <Tabs defaultValue="discrepancies">
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
              <Label className="text-xs mb-1.5 block">Recipient Email *</Label>
              <Input
                data-testid="input-email-to"
                type="email"
                placeholder="client@example.com"
                value={emailForm.to}
                onChange={e => setEmailForm(f => ({ ...f, to: e.target.value }))}
              />
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
                  <SelectItem value="csv">CSV</SelectItem>
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
                disabled={emailMutation.isPending || !emailForm.to || !emailForm.subject}
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
    </div>
  );
}
