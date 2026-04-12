import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import { TrendingUp, Users, Network, Radio, ArrowLeftRight, RefreshCw, Activity } from "lucide-react";

interface LiveGraphsData {
  trend:       { time: string; avg: number; peak: number }[];
  byClient:    { name: string; calls: number }[];
  byVendor:    { name: string; calls: number }[];
  byCodec:     { name: string; calls: number }[];
  byDirection: { name: string; calls: number }[];
  liveCount:    number;
  peakCount:    number;
  windowHours:  number;
  pointsCollected: number;
  oldestPoint:  number | null;
}

const COLORS = [
  "#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444",
  "#06b6d4","#ec4899","#84cc16","#f97316","#6366f1",
  "#14b8a6","#a855f7","#22c55e","#eab308","#64748b",
];

const DIR_COLORS: Record<string, string> = {
  vendor:   "#3b82f6",
  customer: "#10b981",
  inbound:  "#10b981",
  outbound: "#3b82f6",
  unknown:  "#64748b",
};

const HOUR_OPTIONS = [1, 3, 6, 12, 24, 48];

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, name, percent }: any) => {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
      {name} {(percent * 100).toFixed(0)}%
    </text>
  );
};

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-card border border-border/50 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${color}`}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground/60">{sub}</span>}
    </div>
  );
}

function HBar({ data, colors }: { data: { name: string; calls: number }[]; colors?: string[] }) {
  if (!data.length) return (
    <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">No data yet</div>
  );
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 32, left: 8, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
        <Tooltip content={({ active, payload, label }) =>
          active && payload?.length ? (
            <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
              <p className="font-semibold">{label}</p>
              <p style={{ color: payload[0]?.color }}>Calls: <b>{payload[0]?.value}</b></p>
            </div>
          ) : null
        } cursor={{ fill: 'hsl(var(--muted))', opacity: 0.25 }} />
        <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => <Cell key={i} fill={(colors ?? COLORS)[i % (colors ?? COLORS).length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function GraphsPage() {
  const [hours, setHours] = useState(3);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<LiveGraphsData>({
    queryKey: ['/api/sippy/live-graphs', hours],
    queryFn: () => fetch(`/api/sippy/live-graphs?hours=${hours}`).then(r => r.json()),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;
  const hasHistory = (data?.trend?.length ?? 0) > 0;
  const coverageMins = data?.oldestPoint
    ? Math.round((Date.now() - data.oldestPoint) / 60_000)
    : 0;

  return (
    <div className="space-y-6 p-1">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-400" />
            Live Call Graphs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time concurrent calls from Sippy Softswitch · auto-refreshes every 30 s
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
            {HOUR_OPTIONS.map(h => (
              <button
                key={h}
                onClick={() => setHours(h)}
                data-testid={`btn-hours-${h}`}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  hours === h
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="btn-refresh-graphs"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground/60">
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${data?.liveCount ? 'bg-green-400 animate-pulse' : 'bg-muted'}`} />
          {updatedAt ? `Updated ${updatedAt}` : 'Loading…'}
        </span>
        {data?.pointsCollected !== undefined && (
          <span>{data.pointsCollected} snapshot{data.pointsCollected !== 1 ? 's' : ''} collected
            {coverageMins > 0 ? ` · ${coverageMins}m of history` : ''}</span>
        )}
        {!isLoading && (data?.pointsCollected ?? 0) < 3 && (
          <span className="text-amber-400/80 flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            History building — more data appears every 30 s
          </span>
        )}
      </div>

      {/* ── KPI stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Live Concurrent Calls"
          value={isLoading ? '…' : data?.liveCount ?? 0}
          sub="right now on Sippy"
          color="text-blue-400"
        />
        <StatCard
          label={`Peak — Last ${hours}h`}
          value={isLoading ? '…' : data?.peakCount ?? 0}
          sub="max concurrent calls"
          color="text-violet-400"
        />
        <StatCard
          label="Active Clients"
          value={isLoading ? '…' : data?.byClient?.length ?? 0}
          sub="with live traffic"
          color="text-emerald-400"
        />
        <StatCard
          label="Active Vendors"
          value={isLoading ? '…' : data?.byVendor?.length ?? 0}
          sub="carrying traffic"
          color="text-amber-400"
        />
      </div>

      {/* ── Chart 1: Concurrent calls trend ──────────────────────────── */}
      <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold">Concurrent Calls Over Time</h2>
          <span className="text-xs text-muted-foreground ml-auto">last {hours}h · avg &amp; peak per bucket</span>
        </div>

        {isLoading ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
        ) : !hasHistory ? (
          <div className="h-56 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Collecting snapshots every 30 s — chart will appear shortly</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data!.trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                interval={data!.trend.length > 20 ? Math.floor(data!.trend.length / 10) : 0}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                domain={[0, 'auto']}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))' }} />
              <Line
                type="monotone"
                dataKey="avg"
                name="Avg Concurrent"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="peak"
                name="Peak"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Charts 2 & 3: By Client + By Vendor ─────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">

        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Live Calls by Client</h2>
            <span className="text-xs text-muted-foreground ml-auto">max over last 5 polls</span>
          </div>
          {isLoading
            ? <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
            : <HBar data={data?.byClient ?? []} />}
        </div>

        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Network className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold">Live Calls by Vendor</h2>
            <span className="text-xs text-muted-foreground ml-auto">max over last 5 polls</span>
          </div>
          {isLoading
            ? <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
            : <HBar data={data?.byVendor ?? []} colors={["#8b5cf6","#3b82f6","#06b6d4","#f59e0b","#ef4444","#10b981","#ec4899","#84cc16"]} />}
        </div>
      </div>

      {/* ── Charts 4 & 5: By Codec + By Direction ───────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">

        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Radio className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold">Live Calls by Codec</h2>
            <span className="text-xs text-muted-foreground ml-auto">max over last 5 polls</span>
          </div>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
          ) : !(data?.byCodec?.length) ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">No codec data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data!.byCodec}
                  dataKey="calls"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  labelLine={false}
                  label={<PieLabel />}
                >
                  {data!.byCodec.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any, n: any) => [v, n]} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <ArrowLeftRight className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold">Live Calls by Direction</h2>
            <span className="text-xs text-muted-foreground ml-auto">vendor vs customer legs</span>
          </div>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
          ) : !(data?.byDirection?.length) ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">No direction data yet</div>
          ) : (
            <HBar
              data={data!.byDirection}
              colors={data!.byDirection.map(d => DIR_COLORS[d.name] ?? COLORS[0])}
            />
          )}
        </div>

      </div>

      {/* Summary footer */}
      <div className="flex flex-wrap gap-4 p-4 bg-card/40 border border-border/40 rounded-xl text-xs text-muted-foreground">
        <span>Window: <strong className="text-foreground">{hours}h</strong></span>
        <span>Current live calls: <strong className="text-foreground">{data?.liveCount ?? 0}</strong></span>
        <span>Peak in window: <strong className="text-foreground">{data?.peakCount ?? 0}</strong></span>
        <span>Snapshots collected: <strong className="text-foreground">{data?.pointsCollected ?? 0}</strong></span>
        <span className="ml-auto text-muted-foreground/50">Polled every 30 s · auto-refreshes every 30 s</span>
      </div>
    </div>
  );
}
