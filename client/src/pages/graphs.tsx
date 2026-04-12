import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import { TrendingUp, Globe, Users, RefreshCw, Clock } from "lucide-react";

interface GraphsData {
  hourly: { hour: string; total: number; answered: number }[];
  byDestination: { name: string; calls: number }[];
  byClient: { name: string; calls: number }[];
  total: number;
  windowHours: number;
  cacheSize?: number;
  cacheUpdatedAt?: string | null;
}

const DEST_COLORS = [
  "#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444",
  "#06b6d4","#ec4899","#84cc16","#f97316","#6366f1",
  "#14b8a6","#a855f7","#22c55e","#eab308","#64748b",
];

const CLIENT_COLORS = [
  "#8b5cf6","#3b82f6","#10b981","#f59e0b","#ef4444",
  "#06b6d4","#ec4899","#84cc16","#f97316","#6366f1",
  "#14b8a6","#a855f7","#22c55e","#eab308","#64748b",
];

const HOUR_OPTIONS = [6, 12, 24, 48, 72];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: <span className="font-bold">{p.value}</span></p>
      ))}
    </div>
  );
};

const BarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p style={{ color: payload[0]?.color }}>Calls: <span className="font-bold">{payload[0]?.value}</span></p>
    </div>
  );
};

export default function GraphsPage() {
  const [hours, setHours] = useState(24);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<GraphsData>({
    queryKey: ['/api/sippy/cdr/graphs', hours],
    queryFn: () => fetch(`/api/sippy/cdr/graphs?hours=${hours}`).then(r => r.json()),
    refetchInterval: 120000,
    staleTime: 60000,
  });

  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <div className="space-y-6 p-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Call Graphs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            CDR-based traffic analysis
            {data ? ` — ${data.total.toLocaleString()} records` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Time window selector */}
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
            {isFetching ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Cache status bar */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground/70">
        <span className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {updatedAt ? `Data as of ${updatedAt}` : 'Loading…'}
        </span>
        {data?.cacheSize !== undefined && (
          <span className="px-2 py-0.5 rounded bg-muted/30 border border-border/40 font-mono">
            {data.cacheSize.toLocaleString()} CDRs cached
          </span>
        )}
        {data?.cacheUpdatedAt && (
          <span className="text-muted-foreground/50">
            cache refreshed {new Date(data.cacheUpdatedAt).toLocaleTimeString()} · updates every 5 min
          </span>
        )}
        {data?.total === 0 && data?.cacheSize === 0 && !isLoading && (
          <span className="text-amber-400/80 flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            CDR cache warming up — data will appear within 60 s
          </span>
        )}
      </div>

      {/* ── Chart 1: Total Calls over Time ─────────────────────────────────── */}
      <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold">Total Calls — Last {hours}h</h2>
          <span className="text-xs text-muted-foreground ml-auto">by hour (UTC)</span>
        </div>

        {isLoading ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
        ) : !data?.hourly?.length ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">No CDR data available for this window</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.hourly} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis
                dataKey="hour"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                interval={hours <= 12 ? 0 : Math.ceil(hours / 12) - 1}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}
                formatter={(v) => v === 'total' ? 'Total Calls' : 'Answered'}
              />
              <Line
                type="monotone"
                dataKey="total"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 2, fill: '#3b82f6' }}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="answered"
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={{ r: 2, fill: '#10b981' }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Charts 2 & 3: Destination-wise + Client-wise ───────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">

        {/* Destination-wise */}
        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold">Top Destinations</h2>
            <span className="text-xs text-muted-foreground ml-auto">by call count</span>
          </div>

          {isLoading ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
          ) : !data?.byDestination?.length ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">No destination data</div>
          ) : (
            <ResponsiveContainer width="100%" height={290}>
              <BarChart
                data={data.byDestination}
                layout="vertical"
                margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
                barCategoryGap="20%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={56}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<BarTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }} />
                <Bar dataKey="calls" radius={[0, 3, 3, 0]}>
                  {data.byDestination.map((_, i) => (
                    <Cell key={i} fill={DEST_COLORS[i % DEST_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Client-wise */}
        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Top Clients</h2>
            <span className="text-xs text-muted-foreground ml-auto">by call count</span>
          </div>

          {isLoading ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
          ) : !data?.byClient?.length ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">No client data</div>
          ) : (
            <ResponsiveContainer width="100%" height={290}>
              <BarChart
                data={data.byClient}
                layout="vertical"
                margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
                barCategoryGap="20%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={80}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<BarTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }} />
                <Bar dataKey="calls" radius={[0, 3, 3, 0]}>
                  {data.byClient.map((_, i) => (
                    <Cell key={i} fill={CLIENT_COLORS[i % CLIENT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Summary bar */}
      {data && (
        <div className="flex flex-wrap gap-4 p-4 bg-card/40 border border-border/40 rounded-xl text-xs text-muted-foreground">
          <span>Window: <strong className="text-foreground">{data.windowHours}h</strong></span>
          <span>CDRs analysed: <strong className="text-foreground">{data.total.toLocaleString()}</strong></span>
          <span>Destinations: <strong className="text-foreground">{data.byDestination.length}</strong></span>
          <span>Clients: <strong className="text-foreground">{data.byClient.length}</strong></span>
          <span className="ml-auto text-muted-foreground/50">Auto-refreshes every 2 min</span>
        </div>
      )}
    </div>
  );
}
