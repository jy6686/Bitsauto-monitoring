import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Clock,
  BarChart2, AlertTriangle, CheckCircle2, Activity,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────────────────────
interface TimelinePoint {
  ts: string;
  qScore: number;
  asr: number | null;
  ner: number | null;
  avgPdd: number | null;
  fasRate: number | null;
  callCount: number;
  stability: string;
}

interface VendorSummary {
  vendor: string;
  currentQ: number;
  minQ: number;
  maxQ: number;
  avgQ: number;
  stability: string;
  trend: 'up' | 'down' | 'flat';
  trendPts: number;
  snapshotCount: number;
  points: TimelinePoint[];
}

interface TimelineResponse {
  vendors: VendorSummary[];
  windowHours: number;
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const qColor = (q: number) =>
  q >= 75 ? 'text-emerald-400' : q >= 55 ? 'text-sky-400' : q >= 35 ? 'text-amber-400' : 'text-rose-400';

const qChartColor = (q: number) =>
  q >= 75 ? '#34d399' : q >= 55 ? '#38bdf8' : q >= 35 ? '#fbbf24' : '#f87171';

const stabilityCfg: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  stable:       { label: 'Stable',       cls: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', icon: <CheckCircle2 className="w-3 h-3" /> },
  recovering:   { label: 'Recovering',   cls: 'bg-sky-500/10 border-sky-500/20 text-sky-300',             icon: <TrendingUp className="w-3 h-3" /> },
  oscillating:  { label: 'Oscillating',  cls: 'bg-amber-500/15 border-amber-500/30 text-amber-300',       icon: <Activity className="w-3 h-3" /> },
  degrading:    { label: 'Degrading',    cls: 'bg-rose-500/15 border-rose-500/30 text-rose-300',          icon: <TrendingDown className="w-3 h-3" /> },
  insufficient: { label: 'Low data',     cls: 'bg-muted/20 border-border/30 text-muted-foreground',       icon: <Clock className="w-3 h-3" /> },
  unknown:      { label: 'Unknown',      cls: 'bg-muted/20 border-border/30 text-muted-foreground',       icon: <Minus className="w-3 h-3" /> },
};

function StabilityBadge({ stability }: { stability: string }) {
  const cfg = stabilityCfg[stability] ?? stabilityCfg.unknown;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider", cfg.cls)}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function TrendArrow({ trend, pts }: { trend: string; pts: number }) {
  if (trend === 'up')   return <span className="text-emerald-400 text-xs font-mono font-bold">▲ +{pts} pts</span>;
  if (trend === 'down') return <span className="text-rose-400 text-xs font-mono font-bold">▼ {pts} pts</span>;
  return <span className="text-muted-foreground text-xs font-mono">→ {pts > 0 ? '+' : ''}{pts} pts</span>;
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as TimelinePoint;
  return (
    <div className="bg-card border border-border/60 rounded-lg shadow-xl p-3 text-[10px] space-y-1 min-w-[160px]">
      <p className="text-muted-foreground font-mono">
        {new Date(d.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Q-Score</span>
        <span className={cn("font-mono font-bold text-sm", qColor(d.qScore))}>Q{d.qScore}</span>
      </div>
      {d.asr !== null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">ASR</span>
          <span className="font-mono">{d.asr}%</span>
        </div>
      )}
      {d.avgPdd !== null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Avg PDD</span>
          <span className="font-mono">{d.avgPdd}s</span>
        </div>
      )}
      {d.fasRate !== null && d.fasRate > 0 && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-rose-400">FAS rate</span>
          <span className="font-mono text-rose-400">{d.fasRate}%</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 pt-1 border-t border-border/30">
        <span className="text-muted-foreground">Calls</span>
        <span className="font-mono">{d.callCount.toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Stability</span>
        <StabilityBadge stability={d.stability} />
      </div>
    </div>
  );
}

// ── Vendor card (sidebar) ─────────────────────────────────────────────────────
function VendorCard({ v, active, onClick }: { v: VendorSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      data-testid={`vendor-card-${v.vendor}`}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-lg border transition-all",
        active
          ? "border-violet-500/50 bg-violet-500/8 ring-1 ring-violet-500/20"
          : "border-border/30 bg-card/30 hover:border-border/60 hover:bg-muted/5"
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-semibold text-foreground truncate">{v.vendor}</span>
        <TrendArrow trend={v.trend} pts={v.trendPts} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <StabilityBadge stability={v.stability} />
        <span className={cn("font-mono font-bold text-sm", qColor(v.currentQ))}>Q{v.currentQ}</span>
      </div>
      {v.snapshotCount > 0 && (
        <div className="flex gap-3 mt-1.5 text-[9px] text-muted-foreground/60">
          <span>min Q{v.minQ}</span>
          <span>max Q{v.maxQ}</span>
          <span>{v.snapshotCount} snaps</span>
        </div>
      )}
    </button>
  );
}

// ── Empty / loading states ─────────────────────────────────────────────────────
function NoDataState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Clock className="w-10 h-10 text-muted-foreground/30" />
      <p className="text-sm font-semibold text-muted-foreground">No Stability History Yet</p>
      <p className="text-xs text-muted-foreground/60 max-w-sm">
        The stability engine snapshots Q-scores every 30 minutes. History builds automatically as calls flow.
        Come back after the first snapshot cycle completes.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VendorStabilityTimelinePage() {
  const qc                        = useQueryClient();
  const [activeVendor, setActive] = useState<string | null>(null);
  const [hours, setHours]         = useState(24);

  const { data, isLoading } = useQuery<TimelineResponse>({
    queryKey: ['/api/vendor-stability-timeline', hours],
    queryFn: async () => {
      const r = await fetch(`/api/vendor-stability-timeline?hours=${hours}`);
      if (!r.ok) throw new Error('Failed to load stability timeline');
      return r.json();
    },
    refetchInterval: 10 * 60_000,
    staleTime: 8 * 60_000,
  });

  const vendors = data?.vendors ?? [];
  const selected = vendors.find(v => v.vendor === activeVendor) ?? vendors[0] ?? null;

  // Chart color based on avg Q
  const chartStroke = selected ? qChartColor(selected.avgQ) : '#38bdf8';
  const chartFill   = chartStroke + '22';

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <div className="border-b border-border/40 bg-card/30">
        <div className="max-w-[1400px] mx-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <Activity className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">Vendor Stability Timeline</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Q-score history · behaviour over time · {data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Window selector */}
              <div className="flex items-center rounded-lg border border-border/40 bg-muted/10 p-0.5 gap-0.5">
                {[12, 24, 48].map(h => (
                  <button
                    key={h}
                    onClick={() => setHours(h)}
                    data-testid={`window-${h}h`}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      hours === h ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >{h}h</button>
                ))}
              </div>
              <Button
                size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                onClick={() => qc.invalidateQueries({ queryKey: ['/api/vendor-stability-timeline'] })}
                data-testid="btn-refresh"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading stability history…
          </div>
        ) : vendors.length === 0 ? (
          <NoDataState />
        ) : (
          <div className="flex gap-5">
            {/* ── Left: vendor list ── */}
            <div className="w-56 flex-shrink-0 space-y-1.5">
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-2 px-1">
                {vendors.length} Vendor{vendors.length !== 1 ? 's' : ''}
              </p>
              {vendors.map(v => (
                <VendorCard
                  key={v.vendor}
                  v={v}
                  active={selected?.vendor === v.vendor}
                  onClick={() => setActive(v.vendor)}
                />
              ))}
            </div>

            {/* ── Right: detail ── */}
            {selected ? (
              <div className="flex-1 min-w-0 space-y-4">
                {/* Summary bar */}
                <div className="rounded-xl border border-border/40 bg-card/40 p-4 flex flex-wrap items-center gap-5">
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Vendor</p>
                    <p className="text-sm font-bold">{selected.vendor}</p>
                  </div>
                  <div className="border-l border-border/40 pl-5">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Current Q</p>
                    <p className={cn("text-2xl font-bold font-mono", qColor(selected.currentQ))}>Q{selected.currentQ}</p>
                  </div>
                  <div className="border-l border-border/40 pl-5">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Avg Q ({hours}h)</p>
                    <p className={cn("text-lg font-bold font-mono", qColor(selected.avgQ))}>Q{selected.avgQ}</p>
                  </div>
                  <div className="border-l border-border/40 pl-5">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Range</p>
                    <p className="text-sm font-mono text-foreground/80">
                      <span className="text-rose-400">Q{selected.minQ}</span>
                      <span className="text-muted-foreground/60 mx-1">—</span>
                      <span className="text-emerald-400">Q{selected.maxQ}</span>
                    </p>
                  </div>
                  <div className="border-l border-border/40 pl-5">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Stability</p>
                    <div className="mt-0.5"><StabilityBadge stability={selected.stability} /></div>
                  </div>
                  <div className="border-l border-border/40 pl-5">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Trend ({hours}h)</p>
                    <div className="mt-0.5"><TrendArrow trend={selected.trend} pts={selected.trendPts} /></div>
                  </div>
                  <div className="ml-auto text-[10px] text-muted-foreground/50">
                    {selected.snapshotCount} snapshots
                  </div>
                </div>

                {/* Chart */}
                <div className="rounded-xl border border-border/40 bg-card/40 p-4">
                  <p className="text-xs font-semibold text-foreground/80 mb-4">Q-Score over time</p>
                  {selected.points.length < 2 ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
                      <Clock className="w-4 h-4" />
                      Only {selected.points.length} snapshot — chart available after 2+ snapshots
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={selected.points} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                        <defs>
                          <linearGradient id="qGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={chartStroke} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={chartStroke} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                        <XAxis
                          dataKey="ts"
                          tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          tick={{ fill: '#888', fontSize: 9 }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fill: '#888', fontSize: 9 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={v => `Q${v}`}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        {/* Quality zone reference lines */}
                        <ReferenceLine y={75} stroke="#34d39930" strokeDasharray="4 4" label={{ value: 'Q75', fill: '#34d39960', fontSize: 9, position: 'right' }} />
                        <ReferenceLine y={40} stroke="#f8717130" strokeDasharray="4 4" label={{ value: 'Q40', fill: '#f8717160', fontSize: 9, position: 'right' }} />
                        <Area
                          type="monotone"
                          dataKey="qScore"
                          name="Q-Score"
                          stroke={chartStroke}
                          strokeWidth={2}
                          fill="url(#qGrad)"
                          dot={false}
                          activeDot={{ r: 4, fill: chartStroke }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Snapshot table */}
                {selected.points.length > 0 && (
                  <div className="rounded-xl border border-border/40 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-border/30 bg-muted/10">
                      <p className="text-xs font-semibold text-foreground/80">Snapshot History</p>
                    </div>
                    <div className="overflow-auto max-h-64">
                      <table className="w-full text-[10px]">
                        <thead className="sticky top-0 bg-muted/20 border-b border-border/30">
                          <tr>
                            <th className="text-left px-3 py-2 text-muted-foreground font-medium">Time</th>
                            <th className="text-center px-3 py-2 text-muted-foreground font-medium">Q</th>
                            <th className="text-center px-3 py-2 text-muted-foreground font-medium">ASR</th>
                            <th className="text-center px-3 py-2 text-muted-foreground font-medium">PDD</th>
                            <th className="text-center px-3 py-2 text-muted-foreground font-medium">FAS%</th>
                            <th className="text-center px-3 py-2 text-muted-foreground font-medium">Calls</th>
                            <th className="text-right px-3 py-2 text-muted-foreground font-medium">Stability</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/20">
                          {[...selected.points].reverse().map((p, i) => (
                            <tr key={i} className="hover:bg-muted/5" data-testid={`snapshot-row-${i}`}>
                              <td className="px-3 py-1.5 font-mono text-muted-foreground/70">
                                {new Date(p.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className={cn("px-3 py-1.5 text-center font-mono font-bold", qColor(p.qScore))}>Q{p.qScore}</td>
                              <td className="px-3 py-1.5 text-center font-mono">{p.asr != null ? `${p.asr}%` : '—'}</td>
                              <td className="px-3 py-1.5 text-center font-mono">{p.avgPdd != null ? `${p.avgPdd}s` : '—'}</td>
                              <td className={cn("px-3 py-1.5 text-center font-mono", p.fasRate && p.fasRate > 0 ? 'text-rose-400' : '')}>
                                {p.fasRate != null ? `${p.fasRate}%` : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-center font-mono">{p.callCount.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right"><StabilityBadge stability={p.stability} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
