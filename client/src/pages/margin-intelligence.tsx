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
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
} from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle,
  DollarSign, Zap, Play, RefreshCw, BellRing, BarChart3, Users, Building2,
} from "lucide-react";

interface MarginRow {
  dimensionName: string;
  dimensionId?:  string;
  revenueUsd?:   number;
  costUsd?:      number;
  marginUsd?:    number;
  marginPct?:    number;
  durationMin?:  number;
  calls?:        number;
  asr?:          number;
  acd?:          number;
  costPerMin?:   number;
}

interface MarginTrendPoint {
  date:       string;
  marginPct?: number;
  marginUsd?: number;
  revenueUsd?: number;
  costUsd?:   number;
}

interface MarginAlert {
  id:            number;
  alertType:     string;
  dimensionType: string;
  dimensionName: string;
  date:          string;
  thresholdPct?: number;
  actualPct?:    number;
  deltaPct?:     number;
  amountUsd?:    number;
  severity:      string;
  message?:      string;
  acknowledged:  boolean;
  triggeredAt:   string;
}

interface AggRow {
  revenueUsd?: number;
  costUsd?:    number;
  marginUsd?:  number;
  marginPct?:  number;
  calls?:      number;
  durationSec?: number;
}

const SEVERITY_CFG: Record<string, { color: string; icon: any }> = {
  critical: { color: 'text-red-400 bg-red-400/10 border-red-400/30',       icon: XCircle },
  high:     { color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', icon: AlertTriangle },
  medium:   { color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',  icon: AlertTriangle },
  low:      { color: 'text-sky-400 bg-sky-400/10 border-sky-400/30',        icon: CheckCircle2 },
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  negative_margin:  'Negative Margin',
  threshold_breach: 'Threshold Breach',
  margin_drop:      'Margin Drop',
  vendor_cost_spike:'Vendor Cost Spike',
};

function fmt(v?: number | null, dec = 2): string { return v == null ? '—' : v.toFixed(dec); }
function fmtPct(v?: number | null): string {
  if (v == null) return '—';
  const color = v < 0 ? 'text-red-400' : v < 5 ? 'text-amber-400' : 'text-emerald-400';
  return v.toFixed(1) + '%';
}
function fmtUsd(v?: number | null): string { return v == null ? '—' : `$${v.toFixed(2)}`; }
function fmtMin(v?: number | null): string { return v == null ? '—' : `${Math.round(v).toLocaleString()} min`; }

function MarginPctCell({ v }: { v?: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const cls = v < 0 ? 'text-red-400 font-semibold' : v < 5 ? 'text-amber-400' : 'text-emerald-400';
  const Icon = v < 0 ? TrendingDown : TrendingUp;
  return (
    <span className={`flex items-center gap-1 ${cls}`}>
      <Icon className="h-3 w-3" />{v.toFixed(1)}%
    </span>
  );
}

export default function MarginIntelligencePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: clients = [], isLoading: loadingClients } = useQuery<MarginRow[]>({
    queryKey: ["/api/margin/clients", selectedDate],
    queryFn: () => apiRequest("GET", `/api/margin/clients?date=${selectedDate}`).then(r => r.json()),
  });

  const { data: vendors = [] } = useQuery<MarginRow[]>({
    queryKey: ["/api/margin/vendors", selectedDate],
    queryFn: () => apiRequest("GET", `/api/margin/vendors?date=${selectedDate}`).then(r => r.json()),
  });

  const { data: aggregate } = useQuery<AggRow>({
    queryKey: ["/api/margin/aggregate", selectedDate],
    queryFn: () => apiRequest("GET", `/api/margin/aggregate?date=${selectedDate}`).then(r => r.json()),
  });

  const { data: trend = [] } = useQuery<MarginTrendPoint[]>({
    queryKey: ["/api/margin/trend"],
    queryFn: () => {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      return apiRequest("GET", `/api/margin/trend?from=${from}&to=${to}&dimension=aggregate`).then(r => r.json());
    },
  });

  const { data: alerts = [] } = useQuery<MarginAlert[]>({
    queryKey: ["/api/margin/alerts"],
    queryFn: () => apiRequest("GET", `/api/margin/alerts?unacknowledged=true`).then(r => r.json()),
  });

  const materializeMutation = useMutation({
    mutationFn: async () => {
      const dmrRows = await apiRequest("GET", `/api/dmr?date=${selectedDate}`).then(r => r.json()).catch(() => []);
      if (!Array.isArray(dmrRows) || dmrRows.length === 0) {
        await apiRequest("POST", "/api/dmr/generate", { date: selectedDate }).then(r => r.json()).catch(() => null);
      }
      return apiRequest("POST", "/api/margin/materialize", { date: selectedDate }).then(r => r.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/margin"] });
      toast({
        title: "Margin materialized",
        description: `${data.clientRows} clients, ${data.vendorRows} vendors, ${data.alertsGenerated} alerts — margin: $${(data.aggregateMargin ?? 0).toFixed(2)}`,
      });
    },
    onError: (err: any) => toast({ title: "Materialization failed", description: err.message, variant: "destructive" }),
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/margin/alerts/${id}`, { acknowledged: true }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/margin/alerts"] }),
  });

  const unackedCount = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Margin Intelligence
          </h1>
          <p className="text-muted-foreground mt-1">
            Telecom commercial profitability — per-client, per-vendor, and aggregate economics
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
            data-testid="button-materialize"
            onClick={() => materializeMutation.mutate()}
            disabled={materializeMutation.isPending}
          >
            <Play className="h-4 w-4 mr-2" />
            {materializeMutation.isPending ? 'Computing…' : 'Compute Margins'}
          </Button>
        </div>
      </div>

      {/* Aggregate KPI bar */}
      {aggregate?.revenueUsd != null ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Revenue', value: fmtUsd(aggregate.revenueUsd), icon: <DollarSign className="h-4 w-4 text-blue-400" />, color: 'text-blue-400' },
            { label: 'Total Cost',    value: fmtUsd(aggregate.costUsd),    icon: <TrendingDown className="h-4 w-4 text-red-400" />,  color: 'text-red-400'  },
            { label: 'Gross Margin',  value: fmtUsd(aggregate.marginUsd),  icon: <TrendingUp className="h-4 w-4 text-emerald-400" />, color: aggregate.marginUsd && aggregate.marginUsd < 0 ? 'text-red-400' : 'text-emerald-400' },
            { label: 'Margin %',      value: fmtPct(aggregate.marginPct),  icon: <Zap className="h-4 w-4 text-amber-400" />,          color: aggregate.marginPct && aggregate.marginPct < 5 ? 'text-amber-400' : 'text-emerald-400' },
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
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-muted-foreground text-sm">
            No margin data for {selectedDate}. Click "Compute Margins" to materialize from DMR.
          </CardContent>
        </Card>
      )}

      {/* Margin trend chart */}
      {trend.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">30-Day Margin % Trend (Aggregate)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="marginGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} width={36} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Margin']} labelFormatter={l => `Date: ${l}`} />
                <ReferenceLine y={5} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: '5% min', fill: '#fbbf24', fontSize: 10 }} />
                <ReferenceLine y={0} stroke="#f87171" strokeDasharray="4 4" />
                <Area dataKey="marginPct" stroke="#34d399" fill="url(#marginGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Main tabs */}
      <Card>
        <CardContent className="p-0">
          <Tabs defaultValue="clients">
            <div className="px-4 pt-4 pb-0">
              <TabsList className="h-8 mb-3">
                <TabsTrigger value="clients" className="text-xs" data-testid="tab-clients">
                  <Users className="h-3.5 w-3.5 mr-1.5" />
                  Clients ({clients.length})
                </TabsTrigger>
                <TabsTrigger value="vendors" className="text-xs" data-testid="tab-vendors">
                  <Building2 className="h-3.5 w-3.5 mr-1.5" />
                  Vendors ({vendors.length})
                </TabsTrigger>
                <TabsTrigger value="alerts" className="text-xs" data-testid="tab-alerts">
                  <BellRing className="h-3.5 w-3.5 mr-1.5" />
                  Alerts
                  {unackedCount > 0 && (
                    <Badge className="ml-1.5 h-4 text-xs bg-red-500/20 text-red-400 border-red-500/30">{unackedCount}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Clients tab */}
            <TabsContent value="clients" className="mt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Revenue</TableHead>
                      <TableHead>Allocated Cost</TableHead>
                      <TableHead>Margin $</TableHead>
                      <TableHead>Margin %</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>ASR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        {loadingClients ? 'Loading…' : 'No data — compute margins first.'}
                      </TableCell></TableRow>
                    )}
                    {clients.map((c, i) => (
                      <TableRow key={c.dimensionName} data-testid={`row-client-${i}`} className={c.marginPct != null && c.marginPct < 0 ? 'bg-red-500/5' : ''}>
                        <TableCell className="text-xs text-muted-foreground w-8">{i + 1}</TableCell>
                        <TableCell className="font-medium text-sm">{c.dimensionName}</TableCell>
                        <TableCell className="text-sm tabular-nums text-blue-400">{fmtUsd(c.revenueUsd)}</TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">{fmtUsd(c.costUsd)}</TableCell>
                        <TableCell className="text-sm tabular-nums font-semibold">{fmtUsd(c.marginUsd)}</TableCell>
                        <TableCell><MarginPctCell v={c.marginPct} /></TableCell>
                        <TableCell className="text-sm tabular-nums">{fmtMin(c.durationMin)}</TableCell>
                        <TableCell className="text-sm tabular-nums">{c.asr != null ? `${c.asr.toFixed(1)}%` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="px-4 py-2 text-xs text-muted-foreground border-t">
                Cost is allocated pro-rata based on revenue share. Exact per-client routing cost allocation available with CDR-level data.
              </p>
            </TabsContent>

            {/* Vendors tab */}
            <TabsContent value="vendors" className="mt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Buy Cost</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Cost / min</TableHead>
                      <TableHead>Calls</TableHead>
                      <TableHead>ASR</TableHead>
                      <TableHead>ACD (min)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendors.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No vendor data — compute margins first.</TableCell></TableRow>
                    )}
                    {vendors.map((v, i) => (
                      <TableRow key={v.dimensionName} data-testid={`row-vendor-${i}`}>
                        <TableCell className="text-xs text-muted-foreground w-8">{i + 1}</TableCell>
                        <TableCell className="font-medium text-sm">{v.dimensionName}</TableCell>
                        <TableCell className="text-sm tabular-nums text-red-400 font-semibold">{fmtUsd(v.costUsd)}</TableCell>
                        <TableCell className="text-sm tabular-nums">{fmtMin(v.durationMin)}</TableCell>
                        <TableCell className="text-sm tabular-nums font-mono">
                          {v.costPerMin != null ? `$${v.costPerMin.toFixed(4)}` : '—'}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{v.calls?.toLocaleString() ?? '—'}</TableCell>
                        <TableCell className="text-sm tabular-nums">{v.asr != null ? `${v.asr.toFixed(1)}%` : '—'}</TableCell>
                        <TableCell className="text-sm tabular-nums">{v.acd != null ? v.acd.toFixed(1) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* Alerts tab */}
            <TabsContent value="alerts" className="mt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Dimension</TableHead>
                      <TableHead>Threshold</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.length === 0 && (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No active alerts.</TableCell></TableRow>
                    )}
                    {alerts.map(alert => {
                      const cfg = SEVERITY_CFG[alert.severity] ?? SEVERITY_CFG.medium;
                      const Icon = cfg.icon;
                      return (
                        <TableRow key={alert.id} className={alert.acknowledged ? 'opacity-50' : ''} data-testid={`row-alert-${alert.id}`}>
                          <TableCell className="text-sm font-mono">{alert.date}</TableCell>
                          <TableCell className="text-sm">{ALERT_TYPE_LABELS[alert.alertType] ?? alert.alertType}</TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-xs text-muted-foreground">{alert.dimensionType}</span>
                              <span className="text-sm font-medium">{alert.dimensionName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{alert.thresholdPct != null ? `${alert.thresholdPct}%` : '—'}</TableCell>
                          <TableCell className="text-sm text-red-400 font-semibold">{alert.actualPct != null ? `${alert.actualPct.toFixed(1)}%` : '—'}</TableCell>
                          <TableCell className="text-sm">{alert.amountUsd != null ? fmtUsd(alert.amountUsd) : '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${cfg.color}`}>
                              <Icon className="h-3 w-3 mr-1" />
                              {alert.severity}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={alert.message ?? ''}>
                            {alert.message}
                          </TableCell>
                          <TableCell>
                            {!alert.acknowledged && (
                              <Button
                                data-testid={`button-ack-alert-${alert.id}`}
                                variant="ghost" size="sm"
                                onClick={() => acknowledgeMutation.mutate(alert.id)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
