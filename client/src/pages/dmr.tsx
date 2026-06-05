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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  TrendingDown, TrendingUp, RefreshCw, Play, CheckCircle2,
  AlertTriangle, XCircle, Activity, DollarSign, Clock, BarChart3,
  Info, Search,
} from "lucide-react";

interface DMRRow {
  id:                 number;
  reportDate:         string;
  dmrVersion:         number;
  parentDmrId?:       number;
  accountId?:         string;
  accountName?:       string;
  vendorId?:          string;
  vendorName?:        string;
  sippyDuration?:     number;
  sippyAmount?:       number;
  sippyCalls?:        number;
  platformDuration?:  number;
  platformAmount?:    number;
  sellAmount?:        number;
  buyAmount?:         number;
  marginAmount?:      number;
  marginPct?:         number;
  driftDuration?:     number;
  driftAmount?:       number;
  totalCalls?:        number;
  asr?:               number;
  acd?:               number;
  discrepancyType:    string;
  verificationStatus: string;
  source:             string;
  notes?:             string;
  generatedAt:        string;
}

interface DMRSummary {
  date:        string;
  matched:     number;
  drifted:     number;
  critical:    number;
  totalAmount: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; rowBg: string }> = {
  verified: { label: 'Matched',  color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', icon: CheckCircle2, rowBg: '' },
  drifted:  { label: 'Drifted',  color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',       icon: AlertTriangle, rowBg: 'bg-amber-500/5' },
  critical: { label: 'Critical', color: 'text-red-400 bg-red-400/10 border-red-400/30',             icon: XCircle,      rowBg: 'bg-red-500/8' },
  pending:  { label: 'Pending',  color: 'text-slate-400 bg-slate-400/10 border-slate-400/30',       icon: Clock,        rowBg: '' },
};

const DISCREPANCY_LABELS: Record<string, string> = {
  exact_match:     'Exact Match',
  duration_drift:  'Duration Drift',
  amount_drift:    'Amount Drift',
  tariff_mismatch: 'Tariff Mismatch',
  missing_cdr:     'Missing CDR',
  duplicate_cdr:   'Duplicate CDR',
};

function fmt(v?: number | null, decimals = 2): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

function fmtDur(sec?: number | null): string {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  return `${m}m`;
}

function DiffCell({ sippy, platform, unit = 'amount' }: { sippy?: number; platform?: number; unit?: 'amount' | 'duration' }) {
  if (sippy == null || platform == null) return <span className="text-muted-foreground">—</span>;
  const diff = sippy - platform;
  const isDiff = Math.abs(diff) > 0.01;
  if (!isDiff) return <span className="text-emerald-400">0.00</span>;
  const cls = diff > 0 ? 'text-amber-400' : 'text-red-400';
  return (
    <span className={cls}>
      {diff > 0 ? '+' : ''}{unit === 'duration' ? fmtDur(Math.abs(diff)) : `$${fmt(Math.abs(diff))}`}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-xs ${cfg.color}`}>
      <Icon className="h-3 w-3 mr-1" />
      {cfg.label}
    </Badge>
  );
}

export default function DMRPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [filter, setFilter] = useState('');

  const { data: reports = [], isLoading } = useQuery<DMRRow[]>({
    queryKey: ["/api/dmr", selectedDate],
    queryFn: () => apiRequest("GET", `/api/dmr?date=${selectedDate}`).then(r => r.json()),
  });

  const { data: trend = [] } = useQuery<DMRSummary[]>({
    queryKey: ["/api/dmr/trend"],
    queryFn: () => {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      return apiRequest("GET", `/api/dmr/trend?from=${from}&to=${to}`).then(r => r.json());
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/dmr/generate", { date: selectedDate }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dmr"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dmr/trend"] });
      const errSuffix = data.errors?.length > 0 ? ` · ${data.errors[0]}` : '';
      toast({
        title: `DMR Generated — v${data.version}`,
        description: `${data.rowsInserted} rows: ${data.matched} matched, ${data.drifted} drifted, ${data.critical} critical${errSuffix}`,
        variant: data.rowsInserted === 0 ? 'destructive' : 'default',
      });
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const recalcMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/dmr/${id}/recalculate`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dmr"] });
      toast({ title: "Recalculation queued", description: "New DMR version created" });
    },
    onError: (err: any) => toast({ title: "Recalculate failed", description: err.message, variant: "destructive" }),
  });

  // Aggregate stats from current date's reports (latest version only)
  const maxVersion = reports.reduce((m, r) => Math.max(m, r.dmrVersion), 0);
  const latest = reports.filter(r => r.dmrVersion === maxVersion && r.accountName !== '__AGGREGATE__');
  const aggregate = reports.find(r => r.accountName === '__AGGREGATE__' && r.dmrVersion === maxVersion);

  const matched  = latest.filter(r => r.verificationStatus === 'verified').length;
  const drifted  = latest.filter(r => r.verificationStatus === 'drifted').length;
  const critical = latest.filter(r => r.verificationStatus === 'critical').length;

  const filtered = (rows: DMRRow[]) => {
    let r = rows;
    if (filter) {
      const q = filter.toLowerCase();
      r = r.filter(x =>
        (x.accountName ?? x.vendorName ?? '').toLowerCase().includes(q) ||
        (x.discrepancyType ?? '').includes(q)
      );
    }
    return r;
  };

  const discrepancyRows = latest.filter(r => r.verificationStatus !== 'verified');

  const DMRTable = ({ rows }: { rows: DMRRow[] }) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client / Vendor</TableHead>
            <TableHead className="text-center" colSpan={2}>Sippy (Source)</TableHead>
            <TableHead className="text-center" colSpan={2}>BitsAuto (Platform)</TableHead>
            <TableHead className="text-center" colSpan={2}>Difference</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Type</TableHead>
            <TableHead></TableHead>
          </TableRow>
          <TableRow className="text-xs text-muted-foreground">
            <TableHead></TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead></TableHead>
            <TableHead></TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                {isLoading ? 'Loading…' : 'No records. Generate DMR for this date to see data.'}
              </TableCell>
            </TableRow>
          )}
          {rows.map(row => {
            const name = row.accountName ?? row.vendorName ?? '—';
            const cfg = STATUS_CONFIG[row.verificationStatus] ?? STATUS_CONFIG.pending;
            return (
              <TableRow key={row.id} className={cfg.rowBg} data-testid={`row-dmr-${row.id}`}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${row.accountName ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
                      {row.accountName ? 'Client' : 'Vendor'}
                    </span>
                    <span className="text-sm font-medium truncate max-w-[140px]" title={name}>{name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm tabular-nums">{fmtDur(row.sippyDuration)}</TableCell>
                <TableCell className="text-sm tabular-nums">${fmt(row.sippyAmount)}</TableCell>
                <TableCell className="text-sm tabular-nums">{fmtDur(row.platformDuration)}</TableCell>
                <TableCell className="text-sm tabular-nums">${fmt(row.platformAmount)}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  <DiffCell sippy={row.sippyDuration} platform={row.platformDuration} unit="duration" />
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  <DiffCell sippy={row.sippyAmount} platform={row.platformAmount} />
                </TableCell>
                <TableCell><StatusBadge status={row.verificationStatus} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {DISCREPANCY_LABELS[row.discrepancyType] ?? row.discrepancyType}
                </TableCell>
                <TableCell>
                  <Button
                    data-testid={`button-recalc-${row.id}`}
                    variant="ghost" size="sm"
                    onClick={() => recalcMutation.mutate(row.id)}
                    title="Recalculate (creates new DMR version)"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
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
            <Activity className="h-6 w-6 text-primary" />
            Daily Minutes Report
          </h1>
          <p className="text-muted-foreground mt-1">
            Daily telecom operational economics — Sippy vs BitsAuto reconciliation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            data-testid="input-date"
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="w-44"
          />
          <Button
            data-testid="button-generate-dmr"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            <Play className="h-4 w-4 mr-2" />
            {generateMutation.isPending ? 'Generating…' : 'Generate DMR'}
          </Button>
        </div>
      </div>

      {/* Governance notice */}
      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <Info className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-400">Append-Only Revenue Assurance</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            DMR rows are never overwritten. Recalculation creates a new version (v2, v3…) with full lineage back to the original.
            Historical economics are immutable — this is the telecom operations audit trail.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Matched',      value: matched,   icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />, color: 'text-emerald-400' },
          { label: 'Drifted',      value: drifted,   icon: <AlertTriangle className="h-4 w-4 text-amber-400" />, color: 'text-amber-400' },
          { label: 'Critical',     value: critical,  icon: <XCircle className="h-4 w-4 text-red-400" />,          color: 'text-red-400' },
          {
            label: 'Total Amount',
            value: aggregate ? `$${fmt(aggregate.sippyAmount)}` : '—',
            icon: <DollarSign className="h-4 w-4 text-blue-400" />,
            color: 'text-blue-400',
          },
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

      {/* Aggregate margin row */}
      {aggregate && (
        <Card className="border-blue-500/20">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-6 flex-wrap text-sm">
              <span className="text-muted-foreground font-medium">P&L Aggregate:</span>
              <span>Revenue: <strong className="text-emerald-400">${fmt(aggregate.sellAmount)}</strong></span>
              <span>Cost: <strong className="text-red-400">${fmt(aggregate.buyAmount)}</strong></span>
              <span>Margin: <strong className="text-blue-400">${fmt(aggregate.marginAmount)} ({fmt(aggregate.marginPct)}%)</strong></span>
              <span className="text-muted-foreground text-xs">v{aggregate.dmrVersion} · {aggregate.reportDate}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trend chart */}
      {trend.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              30-Day Reconciliation Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={trend} barSize={8} barGap={2}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} width={30} />
                <Tooltip
                  formatter={(val, name) => [val, name === 'matched' ? 'Matched' : name === 'drifted' ? 'Drifted' : 'Critical']}
                  labelFormatter={l => `Date: ${l}`}
                />
                <Bar dataKey="matched"  fill="#34d399" radius={[2, 2, 0, 0]} />
                <Bar dataKey="drifted"  fill="#fbbf24" radius={[2, 2, 0, 0]} />
                <Bar dataKey="critical" fill="#f87171" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 justify-end text-xs text-muted-foreground mt-2">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />Matched</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />Drifted</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />Critical</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base">
                {selectedDate} — Version {maxVersion > 0 ? maxVersion : '—'}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {latest.length} account row(s) · {discrepancyRows.length} discrepanc{discrepancyRows.length === 1 ? 'y' : 'ies'}
              </CardDescription>
            </div>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                data-testid="input-filter"
                placeholder="Filter by name or type…"
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
                  {discrepancyRows.length > 0 && (
                    <Badge className="ml-1.5 h-4 text-xs bg-red-500/20 text-red-400 border-red-500/30">
                      {discrepancyRows.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs" data-testid="tab-all">
                  All Records ({latest.length})
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="discrepancies" className="mt-0">
              <DMRTable rows={filtered(discrepancyRows)} />
            </TabsContent>
            <TabsContent value="all" className="mt-0">
              <DMRTable rows={filtered(latest)} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
