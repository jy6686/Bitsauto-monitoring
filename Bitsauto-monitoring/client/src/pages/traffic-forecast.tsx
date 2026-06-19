import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { BseTooltip, BSE_GRID_PROPS } from '@/components/bse-chart';
import {
  TrendingUp, Loader2, AlertTriangle, RefreshCw, Clock,
  BarChart2, Activity, Zap, Info,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ForecastPoint {
  label:        string;
  hour:         number;
  expected:     number;
  optimistic:   number;
  pessimistic:  number;
  bandWidth:    number;
  actual:       number | null;
  isAlerted:    boolean;
  deviationPct: number | null;
}

interface ForecastAlert {
  hour:          number;
  label:         string;
  actual:        number;
  expected:      number;
  deviationPct:  number;
}

interface TrafficForecastData {
  points:       ForecastPoint[];
  alerts:       ForecastAlert[];
  peakHour:     string | null;
  peakExpected: number;
  daysAvailable: number;
  windowHours:  number;
  currentHour:  string;
}

// ─── Custom dot for alerts ───────────────────────────────────────────────────

function AlertDot(props: any) {
  const { cx, cy, payload } = props;
  if (payload?.actual == null) return null;
  if (payload?.isAlerted) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill="#dc2626" stroke="#fff" strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={10} fill="#dc262640" />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={3} fill="#10b981" stroke="#fff" strokeWidth={1} />;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TrafficForecastPage() {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<TrafficForecastData>({
    queryKey: ['/api/traffic-forecast'],
    refetchInterval: 5 * 60 * 1000,
  });

  const d = data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  const totalExpected = d?.points.reduce((s, p) => s + p.expected, 0) ?? 0;
  const alertCount    = d?.alerts.length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-indigo-400" />
          <div>
            <h1 className="text-base font-semibold">Traffic Forecasting Dashboard</h1>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              Same-hour-of-day patterns · {d?.daysAvailable ?? 0} days baseline · {d?.windowHours ?? 72}h window
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 cursor-help text-muted-foreground/50" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs leading-relaxed">
                    Forecast uses historical CDR volumes per hour-of-day from the rolling 72h cache.
                    Confidence bands = ±1 standard deviation. Alerts fire when actual traffic deviates more than 30% from expected.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground/60">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 text-xs hover:bg-muted/30 transition-colors disabled:opacity-50"
            data-testid="btn-refresh-forecast"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Deviation alerts ─────────────────────────────────────────────────── */}
      {alertCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-medium text-red-300">
              {alertCount} hour{alertCount > 1 ? 's' : ''} with &gt;30% traffic deviation
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {d!.alerts.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg px-2.5 py-1 text-xs font-mono" data-testid={`alert-${i}`}>
                {a.label} — actual {a.actual} vs expected {a.expected}
                <span className="text-red-400 font-bold">({a.deviationPct > 0 ? '+' : ''}{a.deviationPct.toFixed(0)}%)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── KPI strip ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            label: 'Current Hour',
            value: d?.currentHour ?? '--:--',
            sub:   'UTC now',
            icon:  Clock,
            color: 'text-foreground',
          },
          {
            label: 'Peak Forecast',
            value: d?.peakHour ?? '--:--',
            sub:   `~${d?.peakExpected ?? 0} calls`,
            icon:  Zap,
            color: 'text-amber-400',
          },
          {
            label: '24h Expected',
            value: totalExpected.toLocaleString(),
            sub:   'total calls forecast',
            icon:  BarChart2,
            color: 'text-indigo-400',
          },
          {
            label: 'Deviation Alerts',
            value: alertCount.toString(),
            sub:   '>30% from forecast',
            icon:  AlertTriangle,
            color: alertCount > 0 ? 'text-red-400' : 'text-emerald-400',
          },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border/40 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <k.icon className="w-3.5 h-3.5 text-muted-foreground/60" />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <div className={`text-2xl font-bold font-mono ${k.color}`}>{k.value}</div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Main chart ───────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border/40 rounded-xl p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold">24-Hour Traffic Forecast</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Starting from current UTC hour · shaded band = ±1σ confidence interval</p>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-6 h-0.5 bg-indigo-400 inline-block rounded" />
              Expected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-6 h-3 bg-indigo-400/20 inline-block rounded border border-indigo-400/30" />
              Confidence band
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-400 inline-block" />
              Actual
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
              Alert (&gt;30%)
            </span>
          </div>
        </div>

        {!d || d.points.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center text-muted-foreground/50 gap-2">
            <Activity className="w-10 h-10 opacity-30" />
            <span className="text-sm">No CDR data available for forecasting</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={d.points} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="bandGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid {...BSE_GRID_PROPS} />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#374151' }}
                interval={2}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickLine={false}
                axisLine={false}
                width={40}
                label={{ value: 'Calls / hr', angle: -90, position: 'insideLeft', offset: 12, style: { fontSize: 9, fill: '#6b7280' } }}
              />

              <BseTooltip
                formatter={(value: number, name: string) => {
                  if (name === 'pessimistic') return [value, 'Pessimistic'];
                  if (name === 'bandWidth')   return [null, null];    // hide bandWidth row
                  if (name === 'expected')    return [value, 'Expected'];
                  if (name === 'actual')      return [value, 'Actual'];
                  return [value, name];
                }}
              />

              {/* Reference line at current hour */}
              <ReferenceLine
                x={d.currentHour}
                stroke="#f59e0b"
                strokeDasharray="5 3"
                label={{ value: 'Now', position: 'top', fontSize: 9, fill: '#f59e0b' }}
              />

              {/* Confidence band — stacked pessimistic + bandWidth */}
              <Area
                type="monotone"
                dataKey="pessimistic"
                stackId="band"
                fill="transparent"
                stroke="#6366f1"
                strokeWidth={0}
                strokeDasharray="4 3"
                strokeOpacity={0.4}
                legendType="none"
                dot={false}
                activeDot={false}
              />
              <Area
                type="monotone"
                dataKey="bandWidth"
                stackId="band"
                fill="url(#bandGradient)"
                stroke="#6366f1"
                strokeWidth={0.5}
                strokeOpacity={0.35}
                legendType="none"
                dot={false}
                activeDot={false}
              />

              {/* Expected line */}
              <Line
                type="monotone"
                dataKey="expected"
                stroke="#818cf8"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#818cf8' }}
              />

              {/* Actual line with alert dots */}
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#10b981"
                strokeWidth={2}
                connectNulls={false}
                dot={<AlertDot />}
                activeDot={{ r: 5, fill: '#10b981' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Hourly table ─────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Hourly Forecast Table</h2>
          <span className="text-xs text-muted-foreground ml-1">· next 24 hours from current UTC hour</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border/40 bg-muted/20">
              <tr>
                <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Hour (UTC)</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Pessimistic</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Expected</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Optimistic</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Actual</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Deviation</th>
              </tr>
            </thead>
            <tbody>
              {d?.points.map((p, i) => (
                <tr
                  key={i}
                  className={`border-b border-border/20 transition-colors ${p.isAlerted ? 'bg-red-500/10' : 'hover:bg-muted/20'}`}
                  data-testid={`forecast-row-${i}`}
                >
                  <td className="px-4 py-2.5 font-mono font-medium">
                    {p.label}
                    {i === 0 && <span className="ml-1.5 text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded uppercase tracking-wide">now</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-blue-400/70">{p.pessimistic}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-indigo-300 font-bold">{p.expected}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-indigo-400/70">{p.optimistic}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {p.actual != null ? (
                      <span className={p.isAlerted ? 'text-red-400 font-bold' : 'text-emerald-400'}>{p.actual}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {p.deviationPct != null ? (
                      <span className={`font-mono font-bold ${p.isAlerted ? 'text-red-400' : 'text-muted-foreground'}`}>
                        {p.deviationPct > 0 ? '+' : ''}{p.deviationPct.toFixed(1)}%
                        {p.isAlerted && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Methodology note ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/30 bg-muted/10 p-5 text-xs text-muted-foreground space-y-1.5">
        <div className="font-medium text-foreground/80 mb-2">Forecasting methodology</div>
        <div><span className="text-foreground/70">Pattern source:</span> Same hour-of-day CDR volumes across all {d?.daysAvailable ?? 0} available days in the 72h rolling cache.</div>
        <div><span className="text-foreground/70">Confidence bands:</span> Mean ± 1 standard deviation. When only 1 day is available, 25% of mean is used as fallback σ.</div>
        <div><span className="text-foreground/70">Deviation alerts:</span> Fired when actual call volume in the current hour deviates more than ±30% from the expected baseline.</div>
        <div><span className="text-foreground/70">Accuracy improves:</span> As more historical CDR data accumulates in the rolling window across multiple same-day-of-week samples.</div>
      </div>
    </div>
  );
}
