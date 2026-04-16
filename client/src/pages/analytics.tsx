
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, DollarSign, TrendingDown, BarChart2, RefreshCw,
  Building2, Zap, Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";

type RevenueSummary = {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  margin: number;
};

type ClientRow = {
  name: string;
  calls: number;
  minutes: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

type VendorRow = {
  name: string;
  calls: number;
  minutes: number;
  cost: number;
};

type AnalyticsData = {
  period: { days: number; since: string };
  summary: RevenueSummary;
  byClient: ClientRow[];
  byVendor: VendorRow[];
};

const PERIOD_OPTIONS = [
  { label: "7 Days",  days: 7  },
  { label: "30 Days", days: 30 },
  { label: "60 Days", days: 60 },
  { label: "90 Days", days: 90 },
];

const BAR_COLORS = ["#10b981","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#06b6d4","#ec4899","#84cc16"];

function fmt$(n: number) { return `$${n.toFixed(2)}`; }
function fmtPct(n: number) { return `${n.toFixed(1)}%`; }

function SummaryCard({ label, value, sub, icon, color }: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
      <div className={`${color} opacity-80 shrink-0`}>{icon}</div>
      <div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const { data, isLoading, refetch, isFetching, error } = useQuery<AnalyticsData>({
    queryKey: ["/api/analytics/revenue", days],
    queryFn: async () => {
      const r = await fetch(`/api/analytics/revenue?days=${days}`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.message ?? 'Failed to load analytics');
      return json;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const summary = data?.summary;
  const byClient = data?.byClient ?? [];
  const byVendor = data?.byVendor ?? [];

  // Prepare chart data
  const clientBarData = byClient.slice(0, 12).map((c, i) => ({
    name: c.name.length > 14 ? c.name.slice(0, 12) + "…" : c.name,
    Revenue: parseFloat(c.revenue.toFixed(2)),
    Cost: parseFloat(c.cost.toFixed(2)),
    Profit: parseFloat(c.profit.toFixed(2)),
    color: BAR_COLORS[i % BAR_COLORS.length],
  }));

  const vendorPieData = byVendor.slice(0, 8).map((v, i) => ({
    name: v.name.length > 14 ? v.name.slice(0, 12) + "…" : v.name,
    value: parseFloat(v.cost.toFixed(2)),
    color: BAR_COLORS[i % BAR_COLORS.length],
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
            Revenue &amp; Margin Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            P&amp;L breakdown by client and vendor — sourced directly from Sippy Softswitch
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {PERIOD_OPTIONS.map(p => (
            <Button
              key={p.days}
              variant={days === p.days ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(p.days)}
              data-testid={`period-${p.days}`}
              className="text-xs"
            >
              {p.label}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-analytics" className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 px-4 py-3 text-sm">
          <span className="font-medium">Unable to load analytics: </span>{(error as Error).message}
          {(error as Error).message?.includes('Portal login') && (
            <span className="block mt-1 text-red-300">
              Ensure API Admin credentials are configured in Settings → API Admin Username/Password.
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-muted-foreground py-16">Loading analytics…</div>
      ) : !summary ? (
        <div className="text-center text-muted-foreground py-16 bg-card border border-border rounded-xl">
          <BarChart2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <div className="font-medium mb-1">No data available</div>
          <div className="text-sm">Make sure Sippy is connected and call snapshots are being captured</div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              label="Total Revenue" value={fmt$(summary.totalRevenue)} sub={`Last ${days} days`}
              icon={<DollarSign className="h-6 w-6" />} color="text-emerald-400"
            />
            <SummaryCard
              label="Total Cost" value={fmt$(summary.totalCost)} sub="Vendor interconnect"
              icon={<TrendingDown className="h-6 w-6" />} color="text-red-400"
            />
            <SummaryCard
              label="Gross Profit" value={fmt$(summary.totalProfit)}
              icon={<Zap className="h-6 w-6" />}
              color={summary.totalProfit >= 0 ? "text-blue-400" : "text-red-400"}
            />
            <SummaryCard
              label="Margin" value={fmtPct(summary.margin)}
              icon={<Target className="h-6 w-6" />}
              color={summary.margin >= 15 ? "text-emerald-400" : summary.margin >= 5 ? "text-yellow-400" : "text-red-400"}
            />
          </div>

          {/* Revenue vs Cost by Client Bar Chart */}
          {clientBarData.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-sm">Revenue vs Cost by Client</h2>
                <span className="text-xs text-muted-foreground">Top {clientBarData.length}</span>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={clientBarData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1c1c1e', border: '1px solid #2d2d30', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmt$(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Revenue" fill="#10b981" radius={[3,3,0,0]} />
                  <Bar dataKey="Cost" fill="#ef4444" radius={[3,3,0,0]} />
                  <Bar dataKey="Profit" fill="#3b82f6" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Vendor Cost Breakdown Pie */}
            {vendorPieData.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingDown className="h-4 w-4 text-red-400" />
                  <h2 className="font-semibold text-sm">Cost by Vendor</h2>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={vendorPieData} cx="50%" cy="50%" outerRadius={85} dataKey="value" nameKey="name" label={({ name, value }) => `${name}: $${value}`} labelLine={false}>
                      {vendorPieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt$(v)} contentStyle={{ backgroundColor: '#1c1c1e', border: '1px solid #2d2d30', borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Client P&L Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Client P&L</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-4 py-2 text-left">Client</th>
                      <th className="px-4 py-2 text-right">Revenue</th>
                      <th className="px-4 py-2 text-right">Cost</th>
                      <th className="px-4 py-2 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byClient.slice(0, 15).map(c => (
                      <tr key={c.name} className="border-b border-border/40 hover:bg-muted/20 transition-colors" data-testid={`row-client-${c.name}`}>
                        <td className="px-4 py-2 text-xs font-medium">{c.name}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-emerald-400">{fmt$(c.revenue)}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-red-400">{fmt$(c.cost)}</td>
                        <td className="px-4 py-2 text-right">
                          <Badge className={`text-xs border-0 ${c.margin >= 15 ? 'bg-emerald-500/20 text-emerald-400' : c.margin >= 5 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                            {fmtPct(c.margin)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {byClient.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground text-sm">No client data for this period</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
