import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useOrgScope } from "@/context/org-scope-context";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line,
} from "recharts";
import {
  RefreshCw, ChevronRight, BarChart3,
  TrendingUp, TrendingDown, Minus, AlertCircle, Globe, Users, Layers,
  ArrowRight, ArrowLeft, LayoutGrid, Maximize2, WifiOff, Plus, Check,
  Activity, TableProperties,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

// ── Types ─────────────────────────────────────────────────────────────────────
interface EntityStats { cur: number; min: number; max: number; avg: number; }
interface DailyPoint  {
  label: string;
  total_calls: number;
  connected_calls: number;
  concurrent_calls: number;
}
interface WeeklyPoint { label: string; total_calls: number; connected_calls: number; }
interface EntityData {
  name: string;
  daily:  DailyPoint[];
  weekly: WeeklyPoint[];
  curConcurrent: number;
  todayCalls:    number;
  trendPct:      number;
  asr:           number;
  acdSecs:       number;
  weeklyAsr:     number;
  clients?:      string[];
  destCountry?:  string;
  destBreakout?: string;
  stats: { total: EntityStats; connected: EntityStats };
  lastUpdatedAt:   string;
  lastUpdatedDate: string;
  usedConcurrentProxy?: boolean;
}
interface Summary {
  totalConcurrent: number;
  totalToday:      number;
  overallAsr:      number;
  overallAcdSecs:  number;
}
interface PerEntityResponse {
  entities: EntityData[];
  totalEntities: number;
  updatedAt: string;
  summary: Summary;
}

// ── Nav state ─────────────────────────────────────────────────────────────────
type NavType =
  | 'welcome'
  | 'clients-all'                               // ?view=clients
  | 'vendors-all'                               // ?view=vendors
  | 'country-agg' | 'country-all' | 'country'  // ?view=countries
  | 'country-clients' | 'country-vendors'
  | 'kam-agg' | 'kam-all' | 'kam'              // ?view=kam[&kamId=N]
  | 'dest-agg' | 'dest-all' | 'dest';          // ?view=destinations

interface NavState {
  type: NavType;
  country?: string;       // active country filter
  kamName?: string;       // active KAM name
  kamId?: number;         // active KAM id (from URL ?kamId=N)
  destName?: string;      // active destination name
  destCountryFilter?: string; // country filter on destinations view
}

function urlToNav(urlView: string, urlParams: URLSearchParams): NavState {
  const kamId = urlParams.get('kamId') ? Number(urlParams.get('kamId')) : undefined;
  if (urlView === 'clients')      return { type: 'clients-all' };
  if (urlView === 'vendors')      return { type: 'vendors-all' };
  if (urlView === 'destinations') return { type: 'dest-all' };
  if (urlView === 'countries')    return { type: 'country-all' };
  if (urlView === 'kam')          return kamId ? { type: 'kam', kamId } : { type: 'kam-all' };
  return { type: 'welcome' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtAcd(secs: number): string {
  if (!secs) return '-';
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}
function asrColor(asr: number) {
  if (asr >= 60) return 'text-emerald-400';
  if (asr >= 40) return 'text-amber-400';
  if (asr > 0)   return 'text-rose-400';
  return 'text-muted-foreground/30';
}
function trendColor(pct: number) {
  if (pct >  10) return 'text-emerald-400';
  if (pct < -10) return 'text-rose-400';
  return 'text-amber-400';
}
function TrendIcon({ pct }: { pct: number }) {
  if (pct >  5) return <TrendingUp  className="w-3 h-3" />;
  if (pct < -5) return <TrendingDown className="w-3 h-3" />;
  return <Minus className="w-3 h-3" />;
}

// Aggregate multiple EntityData into one merged dataset
function aggregateEntities(entities: EntityData[], name = 'All Aggregated'): EntityData | null {
  if (!entities.length) return null;
  const base = entities[0];
  const dailyMap: Record<string, DailyPoint> = {};
  const weeklyMap: Record<string, WeeklyPoint> = {};
  for (const e of entities) {
    for (const d of e.daily) {
      if (!dailyMap[d.label]) dailyMap[d.label] = { label: d.label, total_calls: 0, connected_calls: 0, concurrent_calls: 0 };
      dailyMap[d.label].total_calls      += d.total_calls;
      dailyMap[d.label].connected_calls  += d.connected_calls;
      dailyMap[d.label].concurrent_calls += d.concurrent_calls;
    }
    for (const w of e.weekly) {
      if (!weeklyMap[w.label]) weeklyMap[w.label] = { label: w.label, total_calls: 0, connected_calls: 0 };
      weeklyMap[w.label].total_calls     += w.total_calls;
      weeklyMap[w.label].connected_calls += w.connected_calls;
    }
  }
  const daily  = base.daily.map(d  => dailyMap[d.label]  ?? d);
  const weekly = base.weekly.map(w => weeklyMap[w.label] ?? w);
  const totals   = daily.map(d => d.total_calls);
  const conns    = daily.map(d => d.connected_calls);
  const safeMin  = (a: number[]) => a.length ? Math.min(...a) : 0;
  const safeMax  = (a: number[]) => a.length ? Math.max(...a) : 0;
  const safeAvg  = (a: number[]) => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0;
  const totalAsr = entities.reduce((s, e) => s + e.todayCalls * e.asr, 0);
  const totalCalls = entities.reduce((s, e) => s + e.todayCalls, 0);
  const asr = totalCalls > 0 ? Math.round(totalAsr / totalCalls) : 0;
  return {
    name,
    daily, weekly,
    curConcurrent: entities.reduce((s, e) => s + e.curConcurrent, 0),
    todayCalls: totalCalls,
    trendPct: 0,
    asr,
    acdSecs: entities.reduce((s, e) => s + e.acdSecs, 0),
    weeklyAsr: asr,
    stats: {
      total:     { cur: totals[totals.length - 1] ?? 0, min: safeMin(totals), max: safeMax(totals), avg: safeAvg(totals) },
      connected: { cur: conns[conns.length - 1]   ?? 0, min: safeMin(conns),  max: safeMax(conns),  avg: safeAvg(conns)  },
    },
    lastUpdatedAt:   entities[0].lastUpdatedAt,
    lastUpdatedDate: entities[0].lastUpdatedDate,
  };
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const labelMap: Record<string, string> = {
    total_calls: 'Total Calls', connected_calls: 'Connected', concurrent_calls: 'Live',
  };
  return (
    <div className="rounded-xl border border-border/50 bg-card/98 backdrop-blur-md px-3.5 py-2.5 text-xs shadow-2xl z-50 min-w-[140px]">
      <p className="font-semibold text-muted-foreground/70 mb-2 truncate max-w-[180px] text-[10px] uppercase tracking-wide">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-5 py-0.5">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground/70">{labelMap[p.dataKey] ?? p.dataKey}</span>
          </span>
          <span className="font-mono font-bold text-foreground tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Large chart panel ─────────────────────────────────────────────────────────
function LargeChart({
  data, title, gradientA, gradientB, colorA, colorB,
  keyA, keyB, labelA, labelB,
}: {
  data: any[];
  title: string;
  gradientA: string; gradientB: string;
  colorA: string; colorB: string;
  keyA: string; keyB: string;
  labelA: string; labelB: string;
}) {
  const hasData = data.some(d => d[keyA] > 0 || d[keyB] > 0);
  const ticks = data.length > 10
    ? data.filter((_, i) => i % Math.ceil(data.length / 6) === 0).map(d => d.label)
    : data.map(d => d.label);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{title}</p>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground/60">
            <span className="w-4 h-1 rounded-full inline-block" style={{ backgroundColor: colorA }} />{labelA}
          </span>
          <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground/60">
            <span className="w-4 h-1 rounded-full inline-block" style={{ backgroundColor: colorB }} />{labelB}
          </span>
        </div>
      </div>
      {!hasData ? (
        <div className="h-44 flex items-center justify-center border border-dashed border-border/20 rounded-xl text-xs text-muted-foreground/25">
          No data
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', height: 188 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <ResponsiveContainer width="100%" height={188}>
              <AreaChart data={data} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientA} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={colorA} stopOpacity={0.45} />
                    <stop offset="75%"  stopColor={colorA} stopOpacity={0.08} />
                    <stop offset="100%" stopColor={colorA} stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id={gradientB} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={colorB} stopOpacity={0.40} />
                    <stop offset="75%"  stopColor={colorB} stopOpacity={0.07} />
                    <stop offset="100%" stopColor={colorB} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  horizontal={true} vertical={false}
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="0"
                />
                <XAxis
                  dataKey="label"
                  ticks={ticks}
                  tick={{ fontSize: 8, fill: 'rgba(148,163,184,0.5)', fontFamily: 'monospace' }}
                  tickLine={false} axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 8, fill: 'rgba(148,163,184,0.5)', fontFamily: 'monospace' }}
                  tickLine={false} axisLine={false}
                  allowDecimals={false} width={28}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: 'rgba(148,163,184,0.2)', strokeWidth: 1, strokeDasharray: '4 2' }}
                />
                <Area
                  type="monotone" dataKey={keyA}
                  stroke={colorA} strokeWidth={2.5}
                  fill={`url(#${gradientA})`}
                  dot={false}
                  activeDot={{ r: 4, fill: colorA, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                  strokeLinejoin="round" strokeLinecap="round"
                />
                <Area
                  type="monotone" dataKey={keyB}
                  stroke={colorB} strokeWidth={2}
                  fill={`url(#${gradientB})`}
                  dot={false}
                  activeDot={{ r: 3.5, fill: colorB, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                  strokeLinejoin="round" strokeLinecap="round"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stats table ───────────────────────────────────────────────────────────────
function StatVal({ v }: { v: number }) {
  return (
    <td className="px-3 py-1.5 text-right text-[11px] tabular-nums font-mono">
      {v === 0 ? <span className="text-muted-foreground/20">—</span> : <span className="text-foreground/80 font-semibold">{v}</span>}
    </td>
  );
}
function StatsTable({ entity }: { entity: EntityData }) {
  return (
    <div className="rounded-xl border border-border/20 bg-muted/5 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/15 bg-muted/10">
            <th className="px-3 py-1.5 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider w-36">Metric</th>
            {(['Cur','Min','Max','Avg'] as const).map(h => (
              <th key={h} className="px-3 py-1.5 text-right text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/10 hover:bg-muted/10 transition-colors">
            <td className="px-3 py-1.5">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: '#8b5cf6' }} />
                <span className="text-[10px] font-semibold text-foreground/70">Total Calls</span>
              </span>
            </td>
            <StatVal v={entity.stats.total.cur} /><StatVal v={entity.stats.total.min} />
            <StatVal v={entity.stats.total.max} /><StatVal v={entity.stats.total.avg} />
          </tr>
          <tr className="hover:bg-muted/10 transition-colors">
            <td className="px-3 py-1.5">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: '#38bdf8' }} />
                <span className="text-[10px] font-semibold text-foreground/70">Connected</span>
              </span>
            </td>
            <StatVal v={entity.stats.connected.cur} /><StatVal v={entity.stats.connected.min} />
            <StatVal v={entity.stats.connected.max} /><StatVal v={entity.stats.connected.avg} />
          </tr>
        </tbody>
        <tfoot>
          <tr className="border-t border-border/15 bg-muted/5">
            <td colSpan={3} className="px-3 pt-1.5 pb-1 text-[9px] text-muted-foreground/30">Last Updated</td>
            <td className="px-3 pt-1.5 pb-1 text-right text-[9px] tabular-nums text-muted-foreground/30 font-mono">{entity.lastUpdatedAt}</td>
            <td className="px-3 pt-1.5 pb-1 text-right text-[9px] tabular-nums text-muted-foreground/30 font-mono">{entity.lastUpdatedDate}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Single entity panel (full size) ──────────────────────────────────────────
function EntityPanel({ entity, dimmed, onDrillDown, drillLabel }: {
  entity: EntityData;
  dimmed?: boolean;
  onDrillDown?: () => void;
  drillLabel?: string;
}) {
  const live = entity.curConcurrent > 0;
  const uid  = entity.name.replace(/[^a-z0-9]/gi, '_').slice(0, 16);
  return (
    <div className={cn(
      "bg-card border rounded-xl overflow-hidden transition-all",
      live ? "border-blue-500/25" : "border-border/30",
      dimmed && "opacity-60",
    )}>
      {/* Header */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-border/25",
        live ? "bg-gradient-to-r from-blue-500/5 to-transparent" : "bg-muted/5",
      )}>
        {live ? (
          <span className="flex items-center gap-1.5 text-[10px] font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-full flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />{entity.curConcurrent} live
          </span>
        ) : (
          <WifiOff className="w-4 h-4 text-muted-foreground/20 flex-shrink-0" />
        )}
        <h3 className="flex-1 text-base font-bold truncate" title={entity.name}>{entity.name}</h3>
        {entity.todayCalls > 0 && (
          <span className={cn("flex items-center gap-1 text-xs font-semibold flex-shrink-0", trendColor(entity.trendPct))}>
            <TrendIcon pct={entity.trendPct} />
            {entity.trendPct > 0 ? '+' : ''}{entity.trendPct}%
          </span>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 border-b border-border/15 divide-x divide-border/10">
        {[
          { label: 'Today',    value: entity.todayCalls > 0 ? entity.todayCalls : '-',  cls: entity.todayCalls > 0 ? 'text-foreground' : 'text-muted-foreground/20' },
          { label: 'ASR',      value: entity.asr > 0 ? `${entity.asr}%` : '-',          cls: asrColor(entity.asr) },
          { label: 'ACD',      value: fmtAcd(entity.acdSecs),                            cls: 'text-foreground' },
          { label: 'Peak/24h', value: entity.stats.total.max || '-',                     cls: 'text-foreground' },
        ].map(item => (
          <div key={item.label} className="flex flex-col items-center py-2.5 gap-0.5">
            <span className="text-[8px] text-muted-foreground/40 uppercase tracking-wider">{item.label}</span>
            <span className={cn("text-sm font-bold tabular-nums", item.cls)}>{item.value}</span>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="p-4 grid grid-cols-2 gap-6 border-b border-border/15">
        <LargeChart
          data={entity.daily}
          title={entity.usedConcurrentProxy ? "Daily  ·  24 h  (concurrent proxy)" : "Daily  ·  24 h"}
          gradientA={`dT_${uid}`} gradientB={`dC_${uid}`}
          colorA="#8b5cf6" colorB="#38bdf8"
          keyA="total_calls" keyB="connected_calls"
          labelA={entity.usedConcurrentProxy ? "Peak Concurrent" : "Total Calls"}
          labelB="Connected"
        />
        <LargeChart
          data={entity.weekly}
          title="Weekly  ·  7 d"
          gradientA={`wT_${uid}`} gradientB={`wC_${uid}`}
          colorA="#f59e0b" colorB="#14b8a6"
          keyA="total_calls" keyB="connected_calls"
          labelA="Total Calls" labelB="Connected"
        />
      </div>

      {/* Stats table */}
      <div className="px-4 py-3"><StatsTable entity={entity} /></div>

      {/* KAM client pills */}
      {entity.clients && entity.clients.length > 0 && (
        <div className="px-4 pb-2 border-t border-border/15 pt-2 flex flex-wrap gap-1.5">
          {entity.clients.slice(0, 8).map(c => (
            <span key={c} className="text-[9px] px-2 py-0.5 rounded-full bg-muted/30 border border-border/25 text-muted-foreground/50">{c}</span>
          ))}
          {entity.clients.length > 8 && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-muted/30 border border-border/25 text-muted-foreground/35">+{entity.clients.length - 8} more</span>
          )}
        </div>
      )}

      {/* Drill-down button */}
      {onDrillDown && (
        <div className={cn("px-4 pb-3 flex justify-end", (!entity.clients || entity.clients.length === 0) && "border-t border-border/15 pt-3")}>
          <button
            onClick={onDrillDown}
            data-testid={`btn-drilldown-${entity.name}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky-400 hover:bg-sky-500/20 transition-colors text-xs font-semibold"
          >
            {drillLabel ?? 'Drill Down'}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}


// ── Graph view types ───────────────────────────────────────────────────────────
interface TrendBucket {
  label: string; ts: number;
  total: number; connected: number; failed: number; asr: number;
}
interface TrendSummary {
  total: number; connected: number; failed: number;
  asr: number; acd: number; cdrWindow: string; bucketMin: number;
}
interface CallTrendResponse { buckets: TrendBucket[]; summary: TrendSummary; }

// ── Graph tooltip ──────────────────────────────────────────────────────────────
function GraphTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d: Record<string, number> = {};
  for (const p of payload) d[p.dataKey] = p.value ?? 0;
  const total = d.total ?? (d.connected ?? 0) + (d.failed ?? 0);
  const asr   = total > 0 ? Math.round((d.connected ?? 0) / total * 1000) / 10 : 0;
  return (
    <div className="rounded-xl border border-border/50 bg-card/98 backdrop-blur-md px-3.5 py-2.5 text-xs shadow-2xl min-w-[150px]">
      <p className="font-semibold text-muted-foreground/70 mb-2 text-[10px] uppercase tracking-wide">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#38bdf8] inline-block" />Connected</span>
          <span className="font-bold tabular-nums">{d.connected ?? 0}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-rose-500 inline-block" />Failed</span>
          <span className="font-bold tabular-nums text-rose-400">{d.failed ?? 0}</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-border/20 pt-1">
          <span className="text-muted-foreground/60">Total</span>
          <span className="font-bold tabular-nums">{total}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground/60">ASR</span>
          <span className={cn("font-bold tabular-nums", asr >= 60 ? 'text-emerald-400' : asr >= 40 ? 'text-amber-400' : 'text-rose-400')}>{asr}%</span>
        </div>
      </div>
    </div>
  );
}

// ── BitsEye Graph View ─────────────────────────────────────────────────────────
function BitsEyeGraphView({ kamId }: { kamId?: number | null }) {
  const [bucket, setBucket] = useState<5 | 15 | 60>(15);

  // Hours shown scales with bucket size
  const hoursBack = bucket === 5 ? 2 : bucket === 15 ? 4 : 24;

  const { data, isFetching } = useQuery<CallTrendResponse>({
    queryKey: ['/api/bitseye/call-trend', bucket, hoursBack, kamId],
    queryFn: async () => {
      const p = new URLSearchParams({ bucket: String(bucket), hours: String(hoursBack) });
      if (kamId) p.set('kamId', String(kamId));
      const r = await fetch(`/api/bitseye/call-trend?${p}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime:       55_000,
    refetchInterval: 60_000,   // Sippy-safe: once per minute, CDR cache only
  });

  const s = data?.summary;
  const buckets = data?.buckets ?? [];

  // Thin ticks for dense bucket sets
  const tickInterval = buckets.length > 24 ? Math.ceil(buckets.length / 12) - 1 : 'preserveStartEnd';

  const kpiItems = [
    { label: 'Total Calls',    value: s ? s.total.toLocaleString()     : '—', cls: 'text-foreground',   testid: 'graph-kpi-total' },
    { label: 'Connected',      value: s ? s.connected.toLocaleString() : '—', cls: 'text-sky-400',      testid: 'graph-kpi-connected' },
    { label: 'Failed',         value: s ? s.failed.toLocaleString()    : '—', cls: 'text-rose-400',     testid: 'graph-kpi-failed' },
    { label: 'ASR',            value: s ? `${s.asr}%`                  : '—', cls: s ? (s.asr >= 60 ? 'text-emerald-400' : s.asr >= 40 ? 'text-amber-400' : 'text-rose-400') : 'text-muted-foreground/30', testid: 'graph-kpi-asr' },
    { label: 'ACD',            value: s?.acd ? fmtAcd(s.acd)           : '—', cls: 'text-violet-400',   testid: 'graph-kpi-acd' },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="bitseye-graph-view">

      {/* ── Time window toggle ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-muted/20 border border-border/30 rounded-lg p-0.5">
          {([5, 15, 60] as const).map(b => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              data-testid={`graph-bucket-${b}`}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-semibold transition-all",
                bucket === b
                  ? "bg-card text-foreground shadow-sm border border-border/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {b === 60 ? '1h' : `${b}m`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
          {isFetching && <RefreshCw className="w-3 h-3 animate-spin" />}
          <span>CDR-based · {hoursBack}h window · 60s refresh</span>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-2">
        {kpiItems.map(k => (
          <div key={k.label}
            className="bg-card border border-border/30 rounded-xl px-4 py-3 flex flex-col gap-1"
            data-testid={k.testid}>
            <span className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{k.label}</span>
            <span className={cn("text-2xl font-bold tabular-nums", k.cls)}>{k.value}</span>
          </div>
        ))}
      </div>

      {/* ── Main chart: Connected (blue) + Failed (red) stacked, Total line ── */}
      <div className="bg-card border border-border/30 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/20">
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold">Call Volume</span>
          </div>
          <div className="flex items-center gap-5 text-[10px] text-muted-foreground/50">
            <span className="flex items-center gap-1.5"><span className="w-8 h-0.5 bg-[#38bdf8] inline-block rounded-full" />Connected</span>
            <span className="flex items-center gap-1.5"><span className="w-8 h-0.5 bg-rose-500/70 inline-block rounded-full" />Failed</span>
            <span className="flex items-center gap-1.5"><span className="w-8 border-t border-dashed border-white/25 inline-block" />Total</span>
          </div>
        </div>

        {buckets.length === 0 && !isFetching ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground/30">
            No CDR data in window — calls will appear once processed
          </div>
        ) : isFetching && buckets.length === 0 ? (
          <div className="h-72 bg-muted/10 animate-pulse rounded-b-xl" />
        ) : (
          <div className="px-4 pt-4 pb-3" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={buckets} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradConn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#38bdf8" stopOpacity={0.40} />
                    <stop offset="80%"  stopColor="#38bdf8" stopOpacity={0.06} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="gradFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#f43f5e" stopOpacity={0.35} />
                    <stop offset="80%"  stopColor="#f43f5e" stopOpacity={0.05} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid horizontal vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 8, fill: 'rgba(148,163,184,0.45)', fontFamily: 'monospace' }}
                  tickLine={false} axisLine={false}
                  interval={tickInterval}
                />
                <YAxis
                  tick={{ fontSize: 8, fill: 'rgba(148,163,184,0.45)', fontFamily: 'monospace' }}
                  tickLine={false} axisLine={false}
                  allowDecimals={false} width={30}
                />
                <Tooltip content={<GraphTooltip />}
                  cursor={{ stroke: 'rgba(148,163,184,0.15)', strokeWidth: 1, strokeDasharray: '4 2' }} />
                {/* Failed — below connected */}
                <Area
                  type="monotone" dataKey="failed"
                  stroke="#f43f5e" strokeWidth={1.5}
                  fill="url(#gradFail)"
                  dot={false}
                  activeDot={{ r: 3.5, fill: '#f43f5e', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                  strokeLinejoin="round" strokeLinecap="round"
                />
                {/* Connected — primary metric */}
                <Area
                  type="monotone" dataKey="connected"
                  stroke="#38bdf8" strokeWidth={2.5}
                  fill="url(#gradConn)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#38bdf8', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                  strokeLinejoin="round" strokeLinecap="round"
                />
                {/* Total — dashed reference line */}
                <Line
                  type="monotone" dataKey="total"
                  stroke="rgba(255,255,255,0.22)" strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={{ r: 3, fill: 'rgba(255,255,255,0.5)', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── ASR trend mini-chart ────────────────────────────────────────────── */}
      <div className="bg-card border border-border/30 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border/20">
          <span className="text-sm font-semibold">Answer Success Rate</span>
          <span className="text-[10px] text-muted-foreground/40">per bucket</span>
        </div>
        {buckets.length > 0 && (
          <div className="px-4 pt-4 pb-3" style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={buckets} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradAsr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#10b981" stopOpacity={0.40} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid horizontal vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label"
                  tick={{ fontSize: 8, fill: 'rgba(148,163,184,0.45)', fontFamily: 'monospace' }}
                  tickLine={false} axisLine={false} interval={tickInterval} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`}
                  tick={{ fontSize: 8, fill: 'rgba(148,163,184,0.45)', fontFamily: 'monospace' }}
                  tickLine={false} axisLine={false} width={34} />
                <Tooltip
                  content={({ active, payload, label: lbl }: any) => {
                    if (!active || !payload?.length) return null;
                    const asr = payload[0]?.value ?? 0;
                    return (
                      <div className="rounded-xl border border-border/50 bg-card/98 px-3 py-2 text-xs shadow-xl">
                        <p className="text-muted-foreground/60 mb-1 text-[10px]">{lbl}</p>
                        <p className={cn("font-bold", asr >= 60 ? 'text-emerald-400' : asr >= 40 ? 'text-amber-400' : 'text-rose-400')}>ASR {asr}%</p>
                      </div>
                    );
                  }}
                  cursor={{ stroke: 'rgba(148,163,184,0.15)', strokeWidth: 1, strokeDasharray: '4 2' }}
                />
                <Area type="monotone" dataKey="asr"
                  stroke="#10b981" strokeWidth={2}
                  fill="url(#gradAsr)"
                  dot={false}
                  activeDot={{ r: 3.5, fill: '#10b981', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                  strokeLinejoin="round" strokeLinecap="round"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BitsEyePage() {
  useAuth();

  // ── URL param → initial nav ────────────────────────────────────────────
  const search = useSearch();
  const urlParams = useMemo(() => new URLSearchParams(search), [search]);
  const urlView   = urlParams.get('view') ?? '';

  const initNav = useMemo<NavState>(() => urlToNav(urlView, urlParams), [urlView]);

  // ── Nav + view mode state ──────────────────────────────────────────────────
  const [nav, setNav] = useState<NavState>(initNav);
  const [lastRefresh,  setLastRefresh]  = useState(Date.now());
  const [viewMode, setViewMode] = useState<'table' | 'graph'>('table');

  // Sync nav when URL view / kamId changes (sidebar clicks)
  useEffect(() => {
    setNav(urlToNav(urlView, urlParams));
  }, [urlView, urlParams.get('kamId')]);

  // ── Org scope — restrict data to user's hierarchy if they have one ────────
  const orgScope = useOrgScope();
  // If the user has a restricted org role (not HOD), force their kamId into the filter
  // unless they've explicitly navigated to a different KAM already (URL takes precedence for HOD)
  const scopedKamId = orgScope.isScoped ? orgScope.kamId : null;

  // ── Determine active filters for data fetching ────────────────────────────
  const activeCountry     = nav.country ?? '';
  const activeKam         = nav.kamName ?? '';
  // Scoped users always see their org subtree; HOD/admin see what the URL says
  const activeKamId       = scopedKamId ?? nav.kamId ?? null;
  const activeDestCountry = nav.destCountryFilter ?? '';

  // ── Data queries ──────────────────────────────────────────────────────────

  // Countries — always fetched
  const { data: countriesData, isFetching: fetchingCountries } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'countries', lastRefresh],
      queryFn: async () => {
        const r = await fetch('/api/bitseye/per-entity?category=countries&aliveOnly=false&orderBy=name');
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      staleTime: 4 * 60_000,
      refetchInterval: 5 * 60_000,
    });

  // KAMs — fetched when needed (country drill-down or KAM views)
  const fetchKams = !!activeCountry || nav.type.startsWith('kam');
  const { data: kamsData, isFetching: fetchingKams } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'kam', activeCountry, activeKamId, lastRefresh],
      queryFn: async () => {
        const p = new URLSearchParams({ category: 'kam', aliveOnly: 'false', orderBy: 'name' });
        if (activeCountry) p.set('countryFilter', activeCountry);
        if (activeKamId)   p.set('kamId', String(activeKamId));
        const r = await fetch(`/api/bitseye/per-entity?${p}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      enabled: fetchKams,
      staleTime: 4 * 60_000,
      refetchInterval: 5 * 60_000,
    });

  // Destinations — fetched when needed (KAM drill-down, dest views)
  const fetchDests = !!activeKam || nav.type.startsWith('dest');
  const { data: destsData, isFetching: fetchingDests } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'destinations', activeCountry, activeKam, activeDestCountry, lastRefresh],
      queryFn: async () => {
        const p = new URLSearchParams({ category: 'destinations', aliveOnly: 'false', orderBy: 'name' });
        const cf = activeCountry || activeDestCountry;
        if (cf)         p.set('countryFilter', cf);
        if (activeKam)  p.set('kamFilter', activeKam);
        const r = await fetch(`/api/bitseye/per-entity?${p}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      enabled: fetchDests,
      staleTime: 4 * 60_000,
      refetchInterval: 5 * 60_000,
    });

  // Clients (all, unfiltered) — for ?view=clients
  const { data: clientsAllData, isFetching: fetchingClientsAll } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'clients', lastRefresh],
      queryFn: async () => {
        const r = await fetch('/api/bitseye/per-entity?category=clients&aliveOnly=false&orderBy=name');
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      enabled: nav.type === 'clients-all',
      staleTime: 20_000,
    });

  // Vendors (all, unfiltered) — for ?view=vendors
  const { data: vendorsAllData, isFetching: fetchingVendorsAll } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'vendors', lastRefresh],
      queryFn: async () => {
        const r = await fetch('/api/bitseye/per-entity?category=vendors&aliveOnly=false&orderBy=name');
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      enabled: nav.type === 'vendors-all',
      staleTime: 20_000,
    });

  // Country-filtered clients/vendors
  const fetchFilteredClients = nav.type === 'country-clients' || nav.type === 'country-vendors';
  const { data: filteredClientsData, isFetching: fetchingFilteredClients } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'clients-filtered', activeCountry, activeKam, lastRefresh],
      queryFn: async () => {
        const cat = nav.type === 'country-vendors' ? 'vendors' : 'clients';
        const p = new URLSearchParams({ category: cat, aliveOnly: 'false', orderBy: 'name' });
        if (activeCountry) p.set('countryFilter', activeCountry);
        if (activeKam)     p.set('kamFilter', activeKam);
        const r = await fetch(`/api/bitseye/per-entity?${p}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      enabled: fetchFilteredClients,
      staleTime: 20_000,
    });

  // KAM-specific client view — when a specific KAM is selected from sidebar, show only
  // that KAM's clients as individual cards (not the aggregated KAM entity).
  const { data: kamClientsData, isFetching: fetchingKamClients } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'clients-by-kam', activeKamId, lastRefresh],
      queryFn: async () => {
        const p = new URLSearchParams({ category: 'clients', aliveOnly: 'false', orderBy: 'name' });
        if (activeKamId) p.set('kamId', String(activeKamId));
        const r = await fetch(`/api/bitseye/per-entity?${p}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      enabled: nav.type === 'kam' && !!activeKamId,
      staleTime: 4 * 60_000,
      refetchInterval: 5 * 60_000,
    });

  // ── Entity lists ──────────────────────────────────────────────────────────
  const countries = useMemo(() => countriesData?.entities ?? [], [countriesData]);
  const kams      = useMemo(() => kamsData?.entities ?? [], [kamsData]);
  const dests     = useMemo(() => destsData?.entities ?? [], [destsData]);

  // Country names for the Destinations filter dropdown
  const countryNames = useMemo(
    () => [...new Set(countries.map(c => c.name))].sort(),
    [countries]
  );

  // ── Main content derivation ───────────────────────────────────────────────
  const { contentEntities, contentTitle, isFetchingContent } = useMemo(() => {
    switch (nav.type) {
      case 'clients-all':
        return { contentEntities: clientsAllData?.entities ?? [], contentTitle: 'All Clients', isFetchingContent: fetchingClientsAll };
      case 'vendors-all':
        return { contentEntities: vendorsAllData?.entities ?? [], contentTitle: 'All Vendors', isFetchingContent: fetchingVendorsAll };
      case 'country-agg': {
        const agg = aggregateEntities(countries);
        return { contentEntities: agg ? [agg] : [], contentTitle: 'All Countries — Aggregated', isFetchingContent: fetchingCountries };
      }
      case 'country-all':
        return { contentEntities: countries, contentTitle: 'All Countries', isFetchingContent: fetchingCountries };
      case 'country': {
        const e = countries.find(c => c.name === nav.country);
        return { contentEntities: e ? [e] : [], contentTitle: nav.country ?? '', isFetchingContent: fetchingCountries };
      }
      case 'country-clients':
        return { contentEntities: filteredClientsData?.entities ?? [], contentTitle: `${nav.country} — Clients`, isFetchingContent: fetchingFilteredClients };
      case 'country-vendors':
        return { contentEntities: filteredClientsData?.entities ?? [], contentTitle: `${nav.country} — Vendors`, isFetchingContent: fetchingFilteredClients };
      case 'kam-agg': {
        const agg = aggregateEntities(kams);
        return { contentEntities: agg ? [agg] : [], contentTitle: 'All KAMs — Aggregated', isFetchingContent: fetchingKams };
      }
      case 'kam-all':
        return { contentEntities: kams, contentTitle: activeCountry ? `KAMs — ${activeCountry}` : 'All KAMs', isFetchingContent: fetchingKams };
      case 'kam': {
        // Show the KAM name as the page title; resolve from kams entity if not in nav state
        const kamName = nav.kamName ?? kams[0]?.name ?? `KAM #${nav.kamId}`;
        // Show individual CLIENT cards filtered to this KAM's accounts (not the aggregate KAM entity)
        return {
          contentEntities: kamClientsData?.entities ?? [],
          contentTitle: kamName,
          isFetchingContent: fetchingKamClients,
        };
      }
      case 'dest-agg': {
        const agg = aggregateEntities(dests);
        return { contentEntities: agg ? [agg] : [], contentTitle: 'All Destinations — Aggregated', isFetchingContent: fetchingDests };
      }
      case 'dest-all': {
        const title = activeKam
          ? `Destinations — ${nav.kamName ?? 'KAM'}`
          : (activeDestCountry ? `Destinations — ${activeDestCountry}` : 'All Destinations');
        return { contentEntities: dests, contentTitle: title, isFetchingContent: fetchingDests };
      }
      case 'dest': {
        const e = dests.find(d => d.name === nav.destName);
        return { contentEntities: e ? [e] : [], contentTitle: nav.destName ?? '', isFetchingContent: fetchingDests };
      }
      default:
        return { contentEntities: [], contentTitle: 'BitsEye', isFetchingContent: false };
    }
  }, [nav, countries, kams, dests, clientsAllData, vendorsAllData, filteredClientsData, kamClientsData,
      fetchingCountries, fetchingKams, fetchingDests, fetchingClientsAll, fetchingVendorsAll, fetchingFilteredClients, fetchingKamClients]);

  // Show all="grid" or single="panel"
  const showGrid = nav.type === 'country-all' || nav.type === 'kam-all' || nav.type === 'dest-all' ||
    nav.type === 'country-clients' || nav.type === 'country-vendors' ||
    nav.type === 'clients-all' || nav.type === 'vendors-all' || nav.type === 'kam';

  // ── Drill-down helpers ─────────────────────────────────────────────────────
  function getDrillDownForEntity(entityName: string): (() => void) | undefined {
    if (nav.type === 'country-all' || nav.type === 'country-agg') {
      return () => setNav({ type: 'kam-all', country: entityName });
    }
    if (nav.type === 'kam-all' || nav.type === 'kam-agg') {
      return () => setNav({ type: 'dest-all', country: nav.country, kamName: entityName });
    }
    // For nav.type === 'kam': we now show individual CLIENT cards — clicking them opens the
    // detail panel (no further drill-down). Returning undefined lets the card handle its own
    // expand/collapse behavior.
    return undefined;
  }
  function getDrillLabel(): string | undefined {
    if (nav.type === 'country-all' || nav.type === 'country-agg') return 'View KAMs';
    if (nav.type === 'kam-all' || nav.type === 'kam-agg') return 'View Destinations';
    return undefined;
  }

  // ── Sub-nav: tabs for current level ───────────────────────────────────────
  // Returns the "peer" toggle nav: Aggregated ↔ All for current level
  type SubNavTab = { label: string; active: boolean; onClick: () => void; icon: React.ReactNode };
  const subNavTabs: SubNavTab[] = useMemo(() => {
    if (nav.type === 'country-agg' || nav.type === 'country-all') {
      return [
        { label: 'Aggregated', active: nav.type === 'country-agg', icon: <Maximize2 className="w-3 h-3" />, onClick: () => setNav({ type: 'country-agg' }) },
        { label: 'All',        active: nav.type === 'country-all', icon: <LayoutGrid className="w-3 h-3" />, onClick: () => setNav({ type: 'country-all' }) },
      ];
    }
    if (nav.type === 'kam-agg' || nav.type === 'kam-all') {
      return [
        { label: 'Aggregated', active: nav.type === 'kam-agg', icon: <Maximize2 className="w-3 h-3" />, onClick: () => setNav({ ...nav, type: 'kam-agg' }) },
        { label: 'All',        active: nav.type === 'kam-all', icon: <LayoutGrid className="w-3 h-3" />, onClick: () => setNav({ ...nav, type: 'kam-all' }) },
      ];
    }
    if (nav.type === 'dest-agg' || nav.type === 'dest-all') {
      return [
        { label: 'Aggregated', active: nav.type === 'dest-agg', icon: <Maximize2 className="w-3 h-3" />, onClick: () => setNav({ ...nav, type: 'dest-agg' }) },
        { label: 'All',        active: nav.type === 'dest-all', icon: <LayoutGrid className="w-3 h-3" />, onClick: () => setNav({ ...nav, type: 'dest-all' }) },
      ];
    }
    return [];
  }, [nav]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function doRefresh() { setLastRefresh(Date.now()); }

  const isFetchingAny = fetchingCountries || fetchingKams || fetchingDests ||
    fetchingClientsAll || fetchingVendorsAll || fetchingFilteredClients || fetchingKamClients;

  // ── Breadcrumb items ───────────────────────────────────────────────────────
  const breadcrumbs: { label: string; onClick?: () => void }[] = useMemo(() => {
    const crumbs: { label: string; onClick?: () => void }[] = [];
    // Only show "Countries" root crumb when we're in the country drill-down path
    const inCountryDrillDown = nav.type.startsWith('country') ||
      (nav.type.startsWith('kam') && !!nav.country) ||
      (nav.type.startsWith('dest') && !!nav.country);
    if (inCountryDrillDown) {
      crumbs.push({ label: 'Countries', onClick: () => setNav({ type: 'country-all' }) });
    }
    if (nav.country) {
      crumbs.push({ label: nav.country, onClick: () => setNav({ type: 'kam-all', country: nav.country }) });
    }
    if (nav.kamName) {
      crumbs.push({ label: nav.kamName, onClick: () => setNav({ type: 'dest-all', country: nav.country, kamName: nav.kamName }) });
    }
    if (nav.destName) {
      crumbs.push({ label: nav.destName });
    }
    return crumbs;
  }, [nav]);

  // ── Back target ───────────────────────────────────────────────────────────
  const backTarget = useMemo((): NavState | null => {
    if (nav.type === 'kam-all' && nav.country)   return { type: 'country-all' };
    if (nav.type === 'dest-all' && nav.kamName)  return { type: 'kam-all', country: nav.country };
    if (nav.type === 'dest-all' && nav.country)  return { type: 'country-all' };
    if (nav.type === 'dest')                     return { type: 'dest-all', country: nav.country, kamName: nav.kamName };
    if (nav.type === 'kam')                      return { type: 'kam-all', country: nav.country };
    if (nav.type === 'country')                  return { type: 'country-all' };
    return null;
  }, [nav]);

  return (
    <div className="flex h-full min-h-screen bg-background overflow-hidden">

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-card/60 backdrop-blur-xl flex-shrink-0">
          {/* Back button */}
          {backTarget && (
            <button
              data-testid="btn-back"
              onClick={() => setNav(backTarget)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors text-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="bg-amber-500/15 border border-amber-500/20 p-1.5 rounded-lg">
              <BarChart3 className="w-4 h-4 text-amber-400" />
            </div>
            <div className="leading-tight">
              <span className="text-sm font-bold">BitsEye</span>
            </div>
          </div>

          {/* Breadcrumb path */}
          {breadcrumbs.length > 0 && (
            <div className="flex items-center gap-1 ml-1">
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                  {crumb.onClick ? (
                    <button
                      className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors font-medium"
                      onClick={crumb.onClick}
                    >{crumb.label}</button>
                  ) : (
                    <span className="text-[11px] text-foreground/80 font-semibold">{crumb.label}</span>
                  )}
                </span>
              ))}
            </div>
          )}

          <div className="flex-1" />

          {/* Live count */}
          {countries.some(c => c.curConcurrent > 0) && (
            <span className="flex items-center gap-1.5 text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              {countries.reduce((s, c) => s + c.curConcurrent, 0)} live
            </span>
          )}

          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 bg-muted/20 border border-border/30 rounded-lg p-0.5">
            <button
              data-testid="btn-view-table"
              onClick={() => setViewMode('table')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                viewMode === 'table'
                  ? "bg-card text-foreground shadow-sm border border-border/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <TableProperties className="w-3.5 h-3.5" />
              Table
            </button>
            <button
              data-testid="btn-view-graph"
              onClick={() => setViewMode('graph')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                viewMode === 'graph'
                  ? "bg-card text-foreground shadow-sm border border-border/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Activity className="w-3.5 h-3.5" />
              Graph
            </button>
          </div>

          <button
            data-testid="btn-refresh"
            onClick={doRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/60 transition-colors text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetchingAny && "animate-spin")} />
            Refresh
          </button>
        </div>

        {/* Sub-navigation strip (Aggregated | All tabs + country filter for destinations) */}
        {(subNavTabs.length > 0 || nav.type === 'dest-all') && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border/25 bg-muted/5 flex-shrink-0">
            {/* Aggregated / All tabs */}
            {subNavTabs.length > 0 && (
              <div className="flex items-center gap-1 bg-muted/20 border border-border/30 rounded-lg p-0.5">
                {subNavTabs.map(tab => (
                  <button
                    key={tab.label}
                    onClick={tab.onClick}
                    data-testid={`tab-${tab.label.toLowerCase()}`}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all",
                      tab.active
                        ? "bg-card text-foreground shadow-sm border border-border/30"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {/* Country filter chip row — shown on Destinations view */}
            {nav.type === 'dest-all' && !nav.kamName && !nav.country && countryNames.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-medium whitespace-nowrap shrink-0 flex items-center gap-1">
                  <Globe className="w-3 h-3" /> Country:
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {countryNames.map(c => {
                    const isOn = nav.destCountryFilter === c;
                    return (
                      <button
                        key={c}
                        data-testid={`chip-country-${c.replace(/\s+/g, '-')}`}
                        onClick={() => setNav({ ...nav, destCountryFilter: isOn ? undefined : c })}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                          isOn
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                            : 'bg-muted/20 border-border/25 text-muted-foreground/50 hover:border-amber-500/30 hover:text-amber-400'
                        }`}
                      >
                        {isOn && <Check className="w-2.5 h-2.5 flex-shrink-0" />}
                        {c}
                      </button>
                    );
                  })}
                </div>
                {nav.destCountryFilter && (
                  <button
                    onClick={() => setNav({ ...nav, destCountryFilter: undefined })}
                    className="text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors whitespace-nowrap shrink-0"
                  >✕ Clear</button>
                )}
              </div>
            )}

            {/* Drill-down path hint */}
            {(nav.type === 'country-all' || nav.type === 'country-agg') && (
              <span className="text-[10px] text-muted-foreground/35 ml-2">Click a country card → View KAMs → View Destinations</span>
            )}
            {(nav.type === 'kam-all') && nav.country && (
              <span className="text-[10px] text-muted-foreground/35 ml-2">KAMs in {nav.country} · Click a card to view destinations</span>
            )}
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-5">
          {viewMode === 'graph' ? (
            <BitsEyeGraphView kamId={activeKamId} />
          ) : nav.type === 'welcome' ? (
            /* Welcome screen */
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
              <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl">
                <BarChart3 className="w-10 h-10 text-amber-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">BitsEye Analytics</h2>
                <p className="text-sm text-muted-foreground/50 mt-2 max-w-sm">
                  Select a view from the sidebar. Use the Countries section to drill down:<br />
                  <span className="text-muted-foreground/40">Country → KAMs → Destinations → Detail</span>
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                {[
                  { label: 'Countries', value: countries.length || '…', icon: <Globe className="w-4 h-4" />, onClick: () => setNav({ type: 'country-all' }) },
                  { label: 'KAMs',     value: '→',                      icon: <Users className="w-4 h-4" />, onClick: () => setNav({ type: 'kam-all' }) },
                  { label: 'Dests',    value: '→',                      icon: <Layers className="w-4 h-4" />, onClick: () => setNav({ type: 'dest-all' }) },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={item.onClick}
                    className="bg-card border border-border/30 rounded-xl px-6 py-4 flex flex-col items-center gap-1 hover:border-border/60 hover:bg-muted/20 transition-all"
                  >
                    <span className="text-muted-foreground/40">{item.icon}</span>
                    <span className="text-lg font-bold">{item.value}</span>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/40">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : isFetchingContent && contentEntities.length === 0 ? (
            /* Loading */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-80 rounded-xl bg-muted/15 animate-pulse border border-border/25" />
              ))}
            </div>
          ) : contentEntities.length === 0 ? (
            /* Empty */
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
              <AlertCircle className="w-12 h-12 text-muted-foreground/15" />
              <div>
                <p className="text-base font-semibold text-muted-foreground/40">No data found</p>
                <p className="text-sm text-muted-foreground/25 mt-1">{contentTitle}</p>
                {(nav.type === 'country-all' || nav.type === 'country-agg') && (
                  <p className="text-xs text-muted-foreground/20 mt-2 max-w-xs mx-auto">
                    Country data is derived from CDR destination numbers. Data appears once calls have been processed.
                  </p>
                )}
              </div>
            </div>
          ) : showGrid ? (
            /* Grid of entity panels */
            <div className="space-y-5">
              {/* Summary bar */}
              <div className="flex items-center gap-4 pb-3 border-b border-border/20">
                <span className="text-xs text-muted-foreground/50">{contentEntities.length} {
                  nav.type === 'clients-all' ? 'clients'
                  : nav.type === 'vendors-all' ? 'vendors'
                  : nav.type.startsWith('country') ? 'countries'
                  : nav.type.startsWith('kam') ? 'KAMs'
                  : 'destinations'
                }</span>
                <span className="text-xs text-muted-foreground/30">·</span>
                <span className="text-xs text-muted-foreground/50">
                  {contentEntities.reduce((s, e) => s + e.todayCalls, 0).toLocaleString()} calls today
                </span>
                <span className="text-xs text-muted-foreground/30">·</span>
                <span className={cn("text-xs", asrColor(
                  Math.round(contentEntities.reduce((s, e) => s + e.todayCalls * e.asr, 0) /
                    Math.max(contentEntities.reduce((s, e) => s + e.todayCalls, 0), 1))
                ))}>
                  ASR {Math.round(contentEntities.reduce((s, e) => s + e.todayCalls * e.asr, 0) /
                    Math.max(contentEntities.reduce((s, e) => s + e.todayCalls, 0), 1))}%
                </span>
                {/* Show current drill context */}
                {nav.country && (
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] text-sky-400/60 bg-sky-500/5 border border-sky-500/15 px-2 py-0.5 rounded-full">
                    <Globe className="w-3 h-3" />{nav.country}
                  </span>
                )}
                {nav.kamName && (
                  <span className="flex items-center gap-1.5 text-[10px] text-violet-400/60 bg-violet-500/5 border border-violet-500/15 px-2 py-0.5 rounded-full">
                    <Users className="w-3 h-3" />{nav.kamName}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {contentEntities.map(entity => (
                  <EntityPanel
                    key={entity.name}
                    entity={entity}
                    onDrillDown={getDrillDownForEntity(entity.name)}
                    drillLabel={getDrillLabel()}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* Single entity panel (or aggregated) */
            <div className="max-w-5xl">
              {contentEntities.map(entity => (
                <EntityPanel key={entity.name} entity={entity} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
