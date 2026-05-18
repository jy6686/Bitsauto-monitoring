import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useOrgScope } from "@/context/org-scope-context";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line, ReferenceLine, ReferenceArea,
} from "recharts";
import {
  RefreshCw, ChevronRight, BarChart3,
  TrendingUp, TrendingDown, Minus, AlertCircle, Globe, Users, Layers,
  ArrowRight, ArrowLeft, LayoutGrid, Maximize2, WifiOff, Plus, Check,
  Activity, TableProperties, PieChart,
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

// Concurrent call stream types (live NOC graph)
interface ConcurrentBucket {
  ts: number;
  label: string;
  active: number;
  connected: number;
  routing: number;
  projected?: number; // saturation prediction extension — undefined on real data points
}
interface ConcurrentTrendResponse {
  points: ConcurrentBucket[];
  summary: {
    peakActive: number;
    currentActive: number;
    currentConnected: number;
    currentRouting: number;
    samplingIntervalSecs: number;
    windowHours: number;
    hasHistory: boolean;
  };
}

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

// ── KAM hierarchy types (for left panel tree) ─────────────────────────────────
interface KamAccount { id: number; kamId: number; accountId: number; clientName: string | null; dropThreshold?: number; }
interface KamNode    { id: number; name: string; email: string; active?: boolean; accounts: KamAccount[]; }
interface DestEntry  { name: string; total: number; connected: number; asr: number; }

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
  // Hierarchy panel selection
  clientId?: number;      // selected Sippy accountId (cascades to all graph queries)
  clientName?: string;    // display name of selected client
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

  const trendPositive = entity.trendPct > 0;
  const trendBg    = trendPositive ? '#F0FDF4' : entity.trendPct < 0 ? '#FEF2F2' : '#F9FAFB';
  const trendClr   = trendPositive ? '#16A34A' : entity.trendPct < 0 ? '#DC2626' : '#6B7280';
  const trendBdr   = trendPositive ? '#BBF7D0' : entity.trendPct < 0 ? '#FECACA' : '#E5E7EB';

  const asrVal = entity.asr;
  const asrClrHard = asrVal >= 60 ? '#16A34A' : asrVal >= 35 ? '#D97706' : asrVal > 0 ? '#DC2626' : '#9CA3AF';

  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 14,
      overflow: 'hidden', transition: 'box-shadow 0.2s',
      boxShadow: live ? '0 0 0 1.5px #BFDBFE, 0 2px 12px rgba(59,130,246,0.08)' : '0 1px 4px rgba(0,0,0,0.06)',
      opacity: dimmed ? 0.6 : 1,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px 10px', borderBottom: '1px solid #F3F4F6',
        background: live ? 'linear-gradient(90deg,#EFF6FF,#FFFFFF)' : '#FAFAFA',
      }}>
        {/* Live indicator dot */}
        {live && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600,
            color: '#2563EB', background: '#EFF6FF', border: '1px solid #BFDBFE',
            padding: '2px 8px', borderRadius: 99, flexShrink: 0,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3B82F6',
              animation: 'pulse 2s infinite', display: 'inline-block' }} />
            {entity.curConcurrent} live
          </span>
        )}
        <h3 style={{ flex: 1, fontSize: 15, fontWeight: 700, color: '#111827',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}
          title={entity.name}>{entity.name}</h3>
        {entity.todayCalls > 0 && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700,
            color: trendClr, background: trendBg, border: `1px solid ${trendBdr}`,
            padding: '2px 8px', borderRadius: 99, flexShrink: 0,
          }}>
            <TrendIcon pct={entity.trendPct} />
            {entity.trendPct > 0 ? '+' : ''}{entity.trendPct}%
          </span>
        )}
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: '1px solid #F3F4F6' }}>
        {[
          { label: 'TODAY',     value: entity.todayCalls > 0 ? entity.todayCalls.toLocaleString() : '—', clr: '#111827' },
          { label: 'ASR',       value: entity.asr > 0 ? `${entity.asr}%` : '—',                          clr: asrClrHard },
          { label: 'ACD',       value: fmtAcd(entity.acdSecs),                                            clr: '#111827' },
          { label: 'PEAK / 24H',value: entity.stats.total.max > 0 ? String(entity.stats.total.max) : '—', clr: '#111827' },
        ].map((item, i) => (
          <div key={item.label} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 6px',
            borderRight: i < 3 ? '1px solid #F3F4F6' : 'none', gap: 3,
          }}>
            <span style={{ fontSize: 8, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{item.label}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: item.clr, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{item.value}</span>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, borderBottom: '1px solid #F3F4F6' }}>
        <LargeChart
          data={entity.daily}
          title={entity.usedConcurrentProxy ? "DAILY  ·  24 H  (concurrent)" : "DAILY  ·  24 H"}
          gradientA={`dT_${uid}`} gradientB={`dC_${uid}`}
          colorA="#8b5cf6" colorB="#38bdf8"
          keyA="total_calls" keyB="connected_calls"
          labelA={entity.usedConcurrentProxy ? "Peak Concurrent" : "Total Calls"}
          labelB="Connected"
        />
        <LargeChart
          data={entity.weekly}
          title="WEEKLY  ·  7 D"
          gradientA={`wT_${uid}`} gradientB={`wC_${uid}`}
          colorA="#f59e0b" colorB="#14b8a6"
          keyA="total_calls" keyB="connected_calls"
          labelA="Total Calls" labelB="Connected"
        />
      </div>

      {/* Stats table */}
      <div style={{ padding: '10px 16px 4px' }}>
        <div style={{ border: '1px solid #F3F4F6', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #F3F4F6', background: '#FAFAFA' }}>
                <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', width: 140 }}>Metric</th>
                {(['CUR','MIN','MAX','AVG'] as const).map(h => (
                  <th key={h} style={{ padding: '6px 12px', textAlign: 'right', fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Total Calls', dot: '#8b5cf6', s: entity.stats.total },
                { label: 'Connected',   dot: '#38bdf8', s: entity.stats.connected },
              ].map((row, ri) => (
                <tr key={row.label} style={{ borderTop: ri > 0 ? '1px solid #F3F4F6' : 'none' }}>
                  <td style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: row.dot, flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: '#374151' }}>{row.label}</span>
                  </td>
                  {[row.s.cur, row.s.min, row.s.max, row.s.avg].map((v, ci) => (
                    <td key={ci} style={{ padding: '7px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', color: v === 0 ? '#D1D5DB' : '#1F2937' }}>
                      {v === 0 ? '—' : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '1px solid #F3F4F6', background: '#FAFAFA' }}>
                <td colSpan={3} style={{ padding: '5px 12px', fontSize: 9, color: '#D1D5DB' }}>Last Updated</td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 9, color: '#D1D5DB', fontFamily: 'monospace' }}>{entity.lastUpdatedAt}</td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 9, color: '#D1D5DB', fontFamily: 'monospace' }}>{entity.lastUpdatedDate}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* KAM client pills */}
      {entity.clients && entity.clients.length > 0 && (
        <div style={{ padding: '8px 16px', display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid #F3F4F6', marginTop: 6 }}>
          {entity.clients.slice(0, 8).map(c => (
            <span key={c} style={{ fontSize: 9, padding: '2px 8px', borderRadius: 99, background: '#F9FAFB', border: '1px solid #E5E7EB', color: '#6B7280' }}>{c}</span>
          ))}
          {entity.clients.length > 8 && (
            <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 99, background: '#F9FAFB', border: '1px solid #E5E7EB', color: '#9CA3AF' }}>+{entity.clients.length - 8} more</span>
          )}
        </div>
      )}

      {/* Drill-down button */}
      {onDrillDown && (
        <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #F3F4F6' }}>
          <button
            onClick={onDrillDown}
            data-testid={`btn-drilldown-${entity.name}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8,
              background: '#F0F9FF', border: '1px solid #BAE6FD', color: '#0284C7',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {drillLabel ?? 'Drill Down'}
            <ArrowRight style={{ width: 13, height: 13 }} />
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

interface GraphEvent {
  ts: number; type: string; severity: string; label: string; detail: string;
  // resolved on client side:
  bucketLabel?: string;
}

// ── Event config (type → color/icon) ──────────────────────────────────────────
// Light-theme chart constants
const AXIS_TICK  = { fontSize: 9, fill: '#9CA3AF', fontFamily: 'Inter, system-ui, sans-serif' };
const GRID_COLOR = '#F1F5F9';

// ── Priority tiers ────────────────────────────────────────────────────────────
// critical: always shown on chart — operational impact, never filtered
// secondary: useful context, behind a toggle to prevent noise
const EVENT_PRIORITY: Record<string, 'critical' | 'secondary'> = {
  incident:       'critical',
  routing_change: 'critical',
  carrier_outage: 'critical',
  fraud_spike:    'secondary',
  account_change: 'secondary',
};

const EVENT_CONFIG: Record<string, { stroke: string; badge: string; icon: string }> = {
  incident:       { stroke: '#DC2626', badge: 'bg-red-50 border-red-200 text-red-700',        icon: '⚠' },
  routing_change: { stroke: '#2563EB', badge: 'bg-blue-50 border-blue-200 text-blue-700',      icon: '↺' },
  carrier_outage: { stroke: '#EA580C', badge: 'bg-orange-50 border-orange-200 text-orange-700', icon: '✕' },
  fraud_spike:    { stroke: '#7C3AED', badge: 'bg-violet-50 border-violet-200 text-violet-700', icon: '⚑' },
  account_change: { stroke: '#D97706', badge: 'bg-amber-50 border-amber-200 text-amber-700',    icon: '●' },
};
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

// ── Cause→Impact correlation scoring ──────────────────────────────────────────
// Compares N buckets before vs after an event on ASR, failed, connected metrics.
// Returns a confidence score (0–100) + optional plain-language impact description.
function scoreCorrelation(
  evType: string,
  bIdx: number,
  buckets: TrendBucket[],
): { score: number; likelyCause: boolean; impactDesc: string | null } {
  const N = 3;
  const before = buckets.slice(Math.max(0, bIdx - N), bIdx);
  const after  = buckets.slice(bIdx + 1, Math.min(buckets.length, bIdx + 1 + N));
  if (!before.length || !after.length) return { score: 0, likelyCause: false, impactDesc: null };

  const avg = (arr: TrendBucket[], key: keyof TrendBucket) =>
    arr.reduce((s, b) => s + (b[key] as number), 0) / arr.length;

  const asrBefore  = avg(before, 'asr');  const asrAfter  = avg(after, 'asr');
  const failBefore = avg(before, 'failed'); const failAfter = avg(after, 'failed');
  const connBefore = avg(before, 'connected'); const connAfter = avg(after, 'connected');

  const asrDrop   = asrBefore  - asrAfter;                                              // positive = worse
  const failSpike = failBefore > 0 ? (failAfter - failBefore) / failBefore * 100 : (failAfter > 0 ? 100 : 0);
  const connDrop  = connBefore > 0 ? (connBefore - connAfter) / connBefore * 100 : 0;

  let score = 0;
  let impactDesc: string | null = null;

  if (evType === 'routing_change') {
    if (asrDrop >= 15)      { score = 92; impactDesc = `ASR dropped ${asrDrop.toFixed(0)}pp — likely caused by this routing change`; }
    else if (asrDrop >= 10) { score = 78; impactDesc = `ASR dropped ${asrDrop.toFixed(0)}pp after routing change`; }
    else if (asrDrop >= 5)  { score = 52; impactDesc = `Mild ASR degradation (${asrDrop.toFixed(0)}pp) after routing change`; }
    else if (connDrop >= 20){ score = 60; impactDesc = `Connected calls dropped ${connDrop.toFixed(0)}% after routing change`; }
  } else if (evType === 'carrier_outage') {
    if (failSpike >= 50)      { score = 96; impactDesc = `Failed calls up ${failSpike.toFixed(0)}% — direct outage impact`; }
    else if (failSpike >= 30) { score = 82; impactDesc = `Failed calls spiked ${failSpike.toFixed(0)}% after outage`; }
    else                      { score = 65; impactDesc = 'Connectivity outage — check failed call pattern'; }
  } else if (evType === 'incident') {
    if (asrDrop >= 10)      { score = 80; impactDesc = `ASR dropped ${asrDrop.toFixed(0)}pp — aligned with incident`; }
    else if (connDrop >= 20){ score = 72; impactDesc = `Connected calls dropped ${connDrop.toFixed(0)}%`; }
    else if (failSpike >= 30){ score = 68; impactDesc = `Failed calls up ${failSpike.toFixed(0)}% around incident`; }
    else                    { score = 38; }
  } else if (evType === 'fraud_spike') {
    if (failSpike >= 20)    { score = 65; impactDesc = `Failed calls up ${failSpike.toFixed(0)}% — possible fraud traffic pressure`; }
    else if (asrDrop >= 8)  { score = 55; impactDesc = `ASR degraded ${asrDrop.toFixed(0)}pp around fraud spike`; }
    else                    { score = 28; }
  } else if (evType === 'account_change') {
    if (asrDrop >= 5 || connDrop >= 10) { score = 55; impactDesc = 'Metric shift aligned with control-plane change'; }
    else                                { score = 18; }
  }

  return { score, likelyCause: score >= 62, impactDesc };
}

// ── CDR chart tooltip (ASR chart) ─────────────────────────────────────────────
function GraphTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d: Record<string, number> = {};
  for (const p of payload) d[p.dataKey] = p.value ?? 0;
  const total = d.total ?? (d.connected ?? 0) + (d.failed ?? 0);
  const asr   = total > 0 ? Math.round((d.connected ?? 0) / total * 1000) / 10 : 0;
  const asrClr = asr >= 60 ? '#16A34A' : asr >= 40 ? '#F59E0B' : '#EF4444';
  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 12, padding: '10px 14px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.09)', minWidth: 160, fontSize: 12, color: '#374151' }}>
      <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#16A34A', display: 'inline-block' }} />Connected
          </span>
          <span style={{ fontWeight: 700, color: '#16A34A' }}>{d.connected ?? 0}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#EF4444', display: 'inline-block' }} />Failed
          </span>
          <span style={{ fontWeight: 700, color: '#EF4444' }}>{d.failed ?? 0}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16,
          borderTop: '1px solid #F3F4F6', paddingTop: 4, marginTop: 2 }}>
          <span style={{ color: '#9CA3AF' }}>Total</span>
          <span style={{ fontWeight: 700, color: '#1F2937' }}>{total}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: '#9CA3AF' }}>ASR</span>
          <span style={{ fontWeight: 700, color: asrClr }}>{asr}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Concurrent call stream tooltip ────────────────────────────────────────────
function ConcurrentGraphTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d: Record<string, number> = {};
  for (const p of payload) d[p.dataKey] = p.value ?? 0;
  const active_calls = d.active ?? (d.connected ?? 0) + (d.routing ?? 0);
  const connPct = active_calls > 0 ? Math.round((d.connected ?? 0) / active_calls * 100) : 0;
  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 12, padding: '10px 14px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.09)', minWidth: 172, fontSize: 12, color: '#374151' }}>
      <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#16A34A', display: 'inline-block' }} />
            Connected
          </span>
          <span style={{ fontWeight: 700, color: '#16A34A' }}>{d.connected ?? 0}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#F59E0B', display: 'inline-block' }} />
            Routing / Setup
          </span>
          <span style={{ fontWeight: 700, color: '#F59E0B' }}>{d.routing ?? 0}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16,
          borderTop: '1px solid #F3F4F6', paddingTop: 4, marginTop: 2 }}>
          <span style={{ color: '#9CA3AF' }}>Total Active</span>
          <span style={{ fontWeight: 700, color: '#2563EB' }}>{active_calls}</span>
        </div>
        {active_calls > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: '#9CA3AF' }}>Connect ratio</span>
            <span style={{ fontWeight: 700, color: connPct >= 80 ? '#16A34A' : connPct >= 50 ? '#F59E0B' : '#EF4444' }}>
              {connPct}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function EventMarkerLabel({ viewBox, event }: { viewBox?: any; event: GraphEvent & { likelyCause?: boolean } }) {
  const cfg = EVENT_CONFIG[event.type] ?? EVENT_CONFIG.incident;
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  return (
    <g>
      {/* Pulsing ring for LIKELY CAUSE markers */}
      {event.likelyCause && (
        <circle cx={x} cy={y + 10} r={9}
          fill="none" stroke={cfg.stroke} strokeWidth={1.5}
          className="noc-cause-ring" />
      )}
      {/* Solid marker circle */}
      <circle cx={x} cy={y + 10} r={event.likelyCause ? 9 : 7}
        fill={cfg.stroke}
        fillOpacity={event.likelyCause ? 0.22 : 0.12}
        stroke={cfg.stroke} strokeWidth={event.likelyCause ? 2 : 1.5} />
      <text x={x} y={y + 14} textAnchor="middle" fontSize={7} fill={cfg.stroke} fontWeight="700">{cfg.icon}</text>
      {/* CAUSE badge — sits above the marker */}
      {event.likelyCause && (
        <g>
          <rect x={x - 18} y={y - 10} width={36} height={12} rx={4}
            fill={cfg.stroke} fillOpacity={0.92} />
          <text x={x} y={y - 1} textAnchor="middle" fontSize={7} fill="#fff" fontWeight="800" letterSpacing="0.03em">
            CAUSE
          </text>
        </g>
      )}
    </g>
  );
}

// ── Latest-point pulse dot for live concurrent chart ──────────────────────────
function LatestPulseDot(props: any) {
  const { cx, cy, index, dataLength, color } = props;
  if (index !== dataLength - 1 || cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="none" stroke={color} strokeWidth={1.5}
        style={{ animation: 'noc-live-dot-ring 2.2s ease-out infinite', transformOrigin: `${cx}px ${cy}px` }} />
      <circle cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={2}
        style={{ animation: 'noc-live-dot-core 2.2s ease-in-out infinite', transformOrigin: `${cx}px ${cy}px` }} />
    </g>
  );
}

// ── Hierarchy Panel — left sidebar KAM → Client tree ──────────────────────────
function HierarchyPanel({
  kams, selectedKamId, selectedAccountId,
  destinations, selectedDestName,
  onSelectKam, onSelectClient, onClearClient, onSelectDest, onClearDest,
}: {
  kams: KamNode[];
  selectedKamId: number | null;
  selectedAccountId: number | null;
  destinations: DestEntry[];
  selectedDestName: string | null;
  onSelectKam: (kam: KamNode) => void;
  onSelectClient: (accountId: number, name: string, kamId: number) => void;
  onClearClient: () => void;
  onSelectDest: (name: string) => void;
  onClearDest: () => void;
}) {
  const [expandedKams, setExpandedKams] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const q = search.toLowerCase().trim();

  const toggleKam = (id: number) => {
    setExpandedKams(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredKams = kams.filter(k =>
    !q || k.name.toLowerCase().includes(q) ||
    k.accounts.some(a => (a.clientName ?? '').toLowerCase().includes(q))
  );

  return (
    <div style={{
      width: 232, flexShrink: 0, borderRight: '1px solid hsl(var(--border) / 0.4)',
      background: 'hsl(var(--card) / 0.6)', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid hsl(var(--border) / 0.3)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
          color: 'hsl(var(--muted-foreground) / 0.5)', marginBottom: 8 }}>
          Intelligence Context
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter KAMs or clients…"
          style={{
            width: '100%', boxSizing: 'border-box',
            fontSize: 11, padding: '5px 8px', borderRadius: 7,
            border: '1px solid hsl(var(--border) / 0.4)',
            background: 'hsl(var(--muted) / 0.3)',
            color: 'hsl(var(--foreground))',
            outline: 'none',
          }}
        />
        {selectedAccountId && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
            background: 'hsl(38 92% 50% / 0.12)', border: '1px solid hsl(38 92% 50% / 0.25)',
            borderRadius: 7, padding: '4px 8px', fontSize: 10 }}>
            <span style={{ flex: 1, fontWeight: 600, color: 'hsl(38 92% 50%)', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ⬡ {kams.flatMap(k => k.accounts).find(a => a.accountId === selectedAccountId)?.clientName ?? `Acct.${selectedAccountId}`}
            </span>
            <button onClick={onClearClient}
              style={{ fontSize: 10, color: 'hsl(var(--muted-foreground) / 0.5)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
              ✕
            </button>
          </div>
        )}
      </div>

      {/* KAM tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {filteredKams.length === 0 && (
          <div style={{ padding: '20px 14px', fontSize: 11, color: 'hsl(var(--muted-foreground) / 0.4)',
            textAlign: 'center' }}>
            No KAMs found
          </div>
        )}
        {filteredKams.map(kam => {
          const isKamSelected = selectedKamId === kam.id;
          const isExpanded    = expandedKams.has(kam.id) || (q.length > 0);
          const visibleAccts  = q
            ? kam.accounts.filter(a => (a.clientName ?? '').toLowerCase().includes(q) || kam.name.toLowerCase().includes(q))
            : kam.accounts;

          return (
            <div key={kam.id}>
              {/* KAM row */}
              <div
                onClick={() => { toggleKam(kam.id); onSelectKam(kam); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                  cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  background: isKamSelected ? 'hsl(var(--muted) / 0.5)' : 'transparent',
                  color: isKamSelected ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground) / 0.75)',
                  transition: 'background 0.15s',
                  borderLeft: isKamSelected ? '2px solid hsl(38 92% 50%)' : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: 9, opacity: 0.5, transform: isExpanded ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.2s', lineHeight: 1 }}>▶</span>
                <Users style={{ width: 12, height: 12, flexShrink: 0, opacity: 0.6 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {kam.name}
                </span>
                {kam.accounts.length > 0 && (
                  <span style={{ fontSize: 9, opacity: 0.4, fontWeight: 400, flexShrink: 0 }}>
                    {kam.accounts.length}
                  </span>
                )}
              </div>

              {/* Client rows */}
              {isExpanded && visibleAccts.map(acc => {
                const name       = acc.clientName ?? `Acct.${acc.accountId}`;
                const isSelected = selectedAccountId === acc.accountId;
                const showDests  = isSelected && destinations.length > 0;
                return (
                  <div key={acc.id}>
                    <div
                      onClick={() => onSelectClient(acc.accountId, name, kam.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '5px 14px 5px 30px', cursor: 'pointer', fontSize: 10.5, fontWeight: 500,
                        background: isSelected ? 'hsl(217 91% 60% / 0.12)' : 'transparent',
                        color: isSelected ? 'hsl(217 91% 65%)' : 'hsl(var(--muted-foreground) / 0.6)',
                        transition: 'background 0.15s',
                        borderLeft: isSelected ? '2px solid hsl(217 91% 60%)' : '2px solid transparent',
                      }}
                    >
                      <span style={{ fontSize: 8, opacity: 0.5, lineHeight: 1,
                        transform: showDests ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      {isSelected && destinations.length > 0 && (
                        <span style={{ fontSize: 8, opacity: 0.4, flexShrink: 0 }}>{destinations.length}</span>
                      )}
                    </div>

                    {/* Destination rows — 3rd level */}
                    {showDests && destinations.map(dest => {
                      const isDestSel = selectedDestName === dest.name;
                      const asrColor  = dest.asr >= 60 ? '#16A34A' : dest.asr >= 35 ? '#D97706' : '#DC2626';
                      return (
                        <div
                          key={dest.name}
                          onClick={() => onSelectDest(dest.name)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 14px 4px 44px', cursor: 'pointer', fontSize: 10,
                            background: isDestSel ? 'hsl(271 91% 60% / 0.10)' : 'transparent',
                            color: isDestSel ? 'hsl(271 91% 65%)' : 'hsl(var(--muted-foreground) / 0.5)',
                            transition: 'background 0.15s',
                            borderLeft: isDestSel ? '2px solid hsl(271 91% 60%)' : '2px solid transparent',
                          }}
                        >
                          <span style={{ width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                            background: isDestSel ? 'hsl(271 91% 60%)' : asrColor, opacity: 0.6 }} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            fontSize: 9.5 }}>{dest.name}</span>
                          <span style={{ fontSize: 8.5, fontWeight: 700, color: asrColor, opacity: 0.7,
                            flexShrink: 0 }}>{dest.asr}%</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid hsl(var(--border) / 0.3)',
        fontSize: 9, color: 'hsl(var(--muted-foreground) / 0.35)', textAlign: 'center' }}>
        KAM → Client → Destination cascade
      </div>
    </div>
  );
}

// ── BitsEye Graph View ─────────────────────────────────────────────────────────
function BitsEyeGraphView({ kamId, accountId, accountName, destFilter }: {
  kamId?: number | null;
  accountId?: number | null;
  accountName?: string | null;
  destFilter?: string | null;
}) {
  const [bucket, setBucket] = useState<5 | 15 | 60>(15);
  const [showEvents, setShowEvents] = useState(true);
  const [showSecondary, setShowSecondary] = useState(false);

  // Hours shown scales with bucket size
  const hoursBack = bucket === 5 ? 2 : bucket === 15 ? 4 : 24;

  // CDR-based trend — used for KPI summary cards and ASR chart
  // accountId takes precedence over kamId; destFilter narrows further to destination level
  const { data, isFetching } = useQuery<CallTrendResponse>({
    queryKey: ['/api/bitseye/call-trend', bucket, hoursBack, kamId, accountId, destFilter],
    queryFn: async () => {
      const p = new URLSearchParams({ bucket: String(bucket), hours: String(hoursBack) });
      if (accountId) p.set('accountId', String(accountId));
      else if (kamId) p.set('kamId', String(kamId));
      if (destFilter) p.set('destFilter', destFilter);
      const r = await fetch(`/api/bitseye/call-trend?${p}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  // Concurrent call stream — used for the main NOC chart (live concurrent, not cumulative)
  const { data: concurrentData, isFetching: concFetching } = useQuery<ConcurrentTrendResponse>({
    queryKey: ['/api/bitseye/concurrent-trend', bucket, hoursBack],
    queryFn: async () => {
      const p = new URLSearchParams({ bucket: String(bucket), hours: String(hoursBack) });
      const r = await fetch(`/api/bitseye/concurrent-trend?${p}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime:       25_000,
    refetchInterval: 60_000,
  });

  const { data: eventsData, isFetching: evFetching } = useQuery<{ events: GraphEvent[] }>({
    queryKey: ['/api/bitseye/graph-events', hoursBack],
    queryFn: async () => {
      const p = new URLSearchParams({ hours: String(hoursBack) });
      const r = await fetch(`/api/bitseye/graph-events?${p}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  const s = data?.summary;
  const buckets = data?.buckets ?? [];
  const concPoints = concurrentData?.points ?? [];
  const concSummary = concurrentData?.summary;
  const tickInterval = buckets.length > 24 ? Math.ceil(buckets.length / 12) - 1 : 'preserveStartEnd';
  const concTickInterval = concPoints.length > 24 ? Math.ceil(concPoints.length / 12) - 1 : 'preserveStartEnd';

  // Map each event to the nearest CDR bucket (for correlation scoring) AND nearest concurrent point (for chart position)
  type ScoredEvent = GraphEvent & { bIdx: number; score: number; likelyCause: boolean; impactDesc: string | null; priority: 'critical' | 'secondary'; concLabel?: string };
  const scoredEvents = useMemo((): ScoredEvent[] => {
    if (!eventsData?.events?.length || !buckets.length) return [];
    return eventsData.events.map(ev => {
      // CDR bucket mapping (for correlation scoring)
      let bestIdx = 0, bestDiff = Infinity;
      buckets.forEach((b, i) => { const d = Math.abs(b.ts - ev.ts); if (d < bestDiff) { bestDiff = d; bestIdx = i; } });
      const label = buckets[bestIdx]?.label;
      if (!label) return null;
      const { score, likelyCause, impactDesc } = scoreCorrelation(ev.type, bestIdx, buckets);
      const priority = EVENT_PRIORITY[ev.type] ?? 'secondary';
      // Concurrent point mapping (for chart overlay position)
      let bestConcIdx = 0, bestConcDiff = Infinity;
      concPoints.forEach((p, i) => { const d = Math.abs(p.ts - ev.ts); if (d < bestConcDiff) { bestConcDiff = d; bestConcIdx = i; } });
      const concLabel = concPoints[bestConcIdx]?.label;
      return { ...ev, bucketLabel: label, bIdx: bestIdx, score, likelyCause, impactDesc, priority, concLabel };
    }).filter(Boolean) as ScoredEvent[];
  }, [eventsData, buckets, concPoints]);

  // Events visible in timeline — filter by priority tier
  const visibleEvents = useMemo(
    () => showSecondary ? scoredEvents : scoredEvents.filter(e => e.priority === 'critical'),
    [scoredEvents, showSecondary],
  );

  // Deduplicate for CDR-based ASR chart reference lines: one per CDR bucket label
  const dedupedEvents = useMemo((): ScoredEvent[] => {
    const map = new Map<string, ScoredEvent>();
    for (const ev of visibleEvents) {
      const key = ev.bucketLabel!;
      const existing = map.get(key);
      if (!existing) { map.set(key, ev); continue; }
      if (ev.likelyCause && !existing.likelyCause) { map.set(key, ev); continue; }
      if (!ev.likelyCause && existing.likelyCause) continue;
      if ((SEVERITY_ORDER[ev.severity] ?? 99) < (SEVERITY_ORDER[existing.severity] ?? 99)) map.set(key, ev);
    }
    return Array.from(map.values());
  }, [visibleEvents]);

  // ── Concurrent derived state ─────────────────────────────────────────────────
  const peakConcurrent = useMemo(() => Math.max(...concPoints.map(p => p.active), 0), [concPoints]);
  // Capacity reference: peak seen + 20% headroom → soft @70%, hard @90%
  const capacityRef  = peakConcurrent > 4 ? Math.ceil(peakConcurrent * 1.2) : 0;
  const capacitySoft = capacityRef > 0 ? Math.round(capacityRef * 0.7) : 0;
  const capacityHard = capacityRef > 0 ? Math.round(capacityRef * 0.9) : 0;

  // Connect ratio from the most recent snapshot
  const lastConcPoint = concPoints[concPoints.length - 1];
  const latestConnectRatio = lastConcPoint && lastConcPoint.active > 0
    ? lastConcPoint.connected / lastConcPoint.active
    : null;

  // Surge detection: last sample jumped ≥ 20% of peak or ≥ 5 calls
  const surgeThreshold = Math.max(5, Math.round(peakConcurrent * 0.20));
  const surgeDelta = concPoints.length >= 2
    ? concPoints[concPoints.length - 1].active - concPoints[concPoints.length - 2].active
    : 0;
  const surgeDetected = surgeDelta >= surgeThreshold;

  // Dynamic card border/glow based on connect ratio
  const ratioGlow = latestConnectRatio === null
    ? { border: '1px solid #E6EAF0', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }
    : latestConnectRatio >= 0.8
    ? { border: '1px solid #BBF7D0', boxShadow: '0 2px 16px rgba(22,163,74,0.12)' }
    : latestConnectRatio >= 0.5
    ? { border: '1px solid #FDE68A', boxShadow: '0 2px 16px rgba(245,158,11,0.14)' }
    : { border: '1px solid #FECACA', boxShadow: '0 2px 16px rgba(239,68,68,0.16)' };

  // ── Saturation Prediction Line (P3) ─────────────────────────────────────────
  // Linear slope from last 6 points → project 4 steps ahead → faint dashed amber line
  const { projectedPoints, minsToCapacity } = useMemo(() => {
    const recent = concPoints.slice(-6).filter(p => p.active > 0);
    if (recent.length < 3 || capacityRef <= 0) return { projectedPoints: [] as typeof concPoints, minsToCapacity: null as number | null };
    const n = recent.length;
    const slope = (recent[n - 1].active - recent[0].active) / (n - 1);
    if (slope < 0.3) return { projectedPoints: [] as typeof concPoints, minsToCapacity: null };
    const lastPt = concPoints[concPoints.length - 1];
    const projPts: typeof concPoints = [];
    for (let i = 1; i <= 4; i++) {
      projPts.push({
        label: `+${i * bucket}m`,
        ts: lastPt.ts + i * bucket * 60_000,
        projected: Math.max(0, Math.round(lastPt.active + slope * i)),
        active: undefined as any,
        connected: undefined as any,
        routing: undefined as any,
      });
    }
    const headroom = capacityRef - lastPt.active;
    if (headroom <= 0) return { projectedPoints: projPts, minsToCapacity: 0 };
    const stepsToHit = headroom / slope;
    const mins = Math.round(stepsToHit * bucket);
    return { projectedPoints: projPts, minsToCapacity: mins < 60 ? mins : null };
  }, [concPoints, capacityRef, bucket]);

  // Merged chart data — actual history + projected tail
  const chartData = useMemo(() => [...concPoints, ...projectedPoints], [concPoints, projectedPoints]);

  // ── Recovery Velocity Indicator (P4) ──────────────────────────────────────
  // Detects when traffic is actively declining back from a recent peak
  const { isRecovering, recoveryPct } = useMemo(() => {
    if (concPoints.length < 4 || peakConcurrent < 5) return { isRecovering: false, recoveryPct: 0 };
    const current = lastConcPoint?.active ?? 0;
    if (current >= peakConcurrent * 0.88) return { isRecovering: false, recoveryPct: 0 };
    // Peak must have been recent (within latter 60% of window)
    const recentSlice = concPoints.slice(-Math.ceil(concPoints.length * 0.6));
    const recentPeak = Math.max(...recentSlice.map(p => p.active), 0);
    if (recentPeak < peakConcurrent * 0.7) return { isRecovering: false, recoveryPct: 0 };
    // Last 4 points must show declining trend
    const last4 = concPoints.slice(-4);
    const ratePerStep = last4.length >= 2
      ? (last4[0].active - last4[last4.length - 1].active) / (last4.length - 1)
      : 0;
    if (ratePerStep <= 0) return { isRecovering: false, recoveryPct: 0 };
    const pct = Math.round((recentPeak - current) / recentPeak * 100);
    return pct >= 10 ? { isRecovering: true, recoveryPct: pct } : { isRecovering: false, recoveryPct: 0 };
  }, [concPoints, peakConcurrent, lastConcPoint]);

  // ── Quality Pressure Correlation (P5) ────────────────────────────────────
  // Recognizes combined patterns: concurrent↑ + ratio↓ + ASR↓
  const qualityPressureHint = useMemo((): string | null => {
    if (concPoints.length < 6 || !s || latestConnectRatio === null) return null;
    const lastN = concPoints.slice(-4);
    const concRising = lastN.length >= 3 && lastN[lastN.length - 1].active > lastN[0].active + 2;
    const ratioPressure = latestConnectRatio < 0.65;
    const asrPressure = s.asr < 50;
    if (concRising && ratioPressure && asrPressure)
      return 'Concurrent ↑  ·  ratio ↓  ·  ASR ↓  — capacity pressure pattern';
    if (concRising && ratioPressure)
      return 'Concurrent ↑  ·  connected ratio ↓  — routing instability possible';
    return null;
  }, [concPoints, latestConnectRatio, s]);

  // Deduplicate for concurrent chart reference lines: one per concurrent point label
  const dedupedConcEvents = useMemo((): ScoredEvent[] => {
    const map = new Map<string, ScoredEvent>();
    for (const ev of visibleEvents) {
      if (!ev.concLabel) continue;
      const key = ev.concLabel;
      const existing = map.get(key);
      if (!existing) { map.set(key, ev); continue; }
      if (ev.likelyCause && !existing.likelyCause) { map.set(key, ev); continue; }
      if (!ev.likelyCause && existing.likelyCause) continue;
      if ((SEVERITY_ORDER[ev.severity] ?? 99) < (SEVERITY_ORDER[existing.severity] ?? 99)) map.set(key, ev);
    }
    return Array.from(map.values());
  }, [visibleEvents]);

  // Compute trend: compare second half vs first half of buckets (connected calls)
  const trendPct = useMemo(() => {
    if (buckets.length < 4) return null;
    const mid = Math.floor(buckets.length / 2);
    const firstHalf  = buckets.slice(0, mid).reduce((s, b) => s + b.connected, 0);
    const secondHalf = buckets.slice(mid).reduce((s, b) => s + b.connected, 0);
    if (firstHalf === 0) return null;
    return Math.round((secondHalf - firstHalf) / firstHalf * 100);
  }, [buckets]);

  const criticalCount   = scoredEvents.filter(e => e.priority === 'critical').length;
  const secondaryCount  = scoredEvents.filter(e => e.priority === 'secondary').length;
  const likelyCauseCount = scoredEvents.filter(e => e.likelyCause).length;
  const hasEvents  = visibleEvents.length > 0;
  const eventCount = visibleEvents.length;

  // Stripe-style KPI card data
  const kpiCards = [
    { label: 'Total Calls',  value: s ? s.total.toLocaleString()     : '—',
      numColor: '#1F2937', trend: trendPct, testid: 'graph-kpi-total' },
    { label: 'Connected',    value: s ? s.connected.toLocaleString() : '—',
      numColor: '#16A34A', trend: trendPct, testid: 'graph-kpi-connected' },
    { label: 'Failed',       value: s ? s.failed.toLocaleString()    : '—',
      numColor: s && s.failed > 0 ? '#EF4444' : '#1F2937', trend: null, testid: 'graph-kpi-failed' },
    { label: 'ASR',          value: s ? `${s.asr}%`                  : '—',
      numColor: s ? (s.asr >= 60 ? '#16A34A' : s.asr >= 40 ? '#F59E0B' : '#EF4444') : '#9CA3AF',
      trend: null, testid: 'graph-kpi-asr' },
    { label: 'ACD',          value: s?.acd ? fmtAcd(s.acd)           : '—',
      numColor: '#2563EB', trend: null, testid: 'graph-kpi-acd' },
  ];

  // Shared chart props for light theme
  const chartCursor = { stroke: '#E6EAF0', strokeWidth: 1.5, strokeDasharray: '4 2' };

  return (
    <div
      data-testid="bitseye-graph-view"
      style={{ background: '#F7F9FC', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}
    >
      {/* ── Header: title + controls ──────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', margin: 0, letterSpacing: '-0.01em' }}>
            Call Intelligence
          </h2>
          <p style={{ fontSize: 11, color: '#9CA3AF', margin: '2px 0 0', fontWeight: 500 }}>
            {destFilter ? (
              <>
                {accountName && <span style={{ color: '#2563EB', fontWeight: 600 }}>{accountName}</span>}
                <span style={{ color: '#9CA3AF', margin: '0 2px' }}>›</span>
                <span style={{ color: '#7C3AED', fontWeight: 700 }}>{destFilter}</span>
              </>
            ) : accountId && accountName ? (
              <span style={{ color: '#2563EB', fontWeight: 700 }}>{accountName}</span>
            ) : kamId ? (
              <span style={{ color: '#7C3AED', fontWeight: 600 }}>KAM scope</span>
            ) : (
              <span>All traffic</span>
            )}
            {' · '}Concurrent live · {hoursBack}h · 60s sampling
            {(isFetching || concFetching || evFetching) && <span style={{ marginLeft: 8, color: '#2563EB' }}>↻</span>}
            {concSummary && (
              <span style={{ marginLeft: 8, color: '#2563EB', fontWeight: 600 }}>
                · {concSummary.currentActive} active now
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Apple-style segmented time control */}
          <div style={{ display: 'flex', background: '#FFFFFF', border: '1px solid #E6EAF0', borderRadius: 10,
            padding: 3, gap: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            {([5, 15, 60] as const).map(b => (
              <button key={b} onClick={() => setBucket(b)} data-testid={`graph-bucket-${b}`}
                style={{
                  padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, border: 'none',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                  background: bucket === b ? '#2563EB' : 'transparent',
                  color: bucket === b ? '#fff' : '#6B7280',
                  boxShadow: bucket === b ? '0 1px 6px rgba(37,99,235,0.30)' : 'none',
                }}>
                {b === 60 ? '1h' : `${b}m`}
              </button>
            ))}
          </div>

          {/* Events toggle — shows critical count + cause count */}
          <button data-testid="graph-toggle-events" onClick={() => setShowEvents(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid', transition: 'all 0.15s ease',
              background: showEvents ? '#FEF3C7' : '#FFFFFF',
              borderColor: showEvents ? '#FCD34D' : '#E6EAF0',
              color: showEvents ? '#92400E' : '#6B7280',
              boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
            }}>
            <AlertCircle style={{ width: 13, height: 13 }} />
            Events{criticalCount > 0 ? ` (${criticalCount})` : ''}
            {likelyCauseCount > 0 && showEvents && (
              <span style={{ background: '#DC2626', color: '#fff', fontSize: 9, fontWeight: 800,
                padding: '1px 5px', borderRadius: 99, marginLeft: 2 }}>
                {likelyCauseCount} CAUSE
              </span>
            )}
          </button>

          {/* Secondary events toggle — only visible when events are on */}
          {showEvents && secondaryCount > 0 && (
            <button data-testid="graph-toggle-secondary" onClick={() => setShowSecondary(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8,
                fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid', transition: 'all 0.15s ease',
                background: showSecondary ? '#EEF2FF' : '#FFFFFF',
                borderColor: showSecondary ? '#A5B4FC' : '#E6EAF0',
                color: showSecondary ? '#4338CA' : '#9CA3AF',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}>
              +{secondaryCount} secondary
            </button>
          )}
        </div>
      </div>

      {/* ── Stripe-style KPI cards — float-in stagger + hover lift ──────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
        {kpiCards.map((k, i) => (
          <div key={k.label} data-testid={k.testid}
            className="noc-float-in"
            style={{ background: '#FFFFFF', border: '1px solid #E6EAF0', borderRadius: 14,
              padding: '14px 18px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 4,
              transition: 'transform 0.2s ease, box-shadow 0.2s ease', cursor: 'default',
              animationDelay: `${i * 55}ms` }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.10)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(0,0,0,0.04)';
            }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase',
              letterSpacing: '0.07em' }}>{k.label}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: k.numColor, letterSpacing: '-0.02em',
                lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{k.value}</span>
              {k.trend !== null && k.trend !== undefined && (
                <span style={{ fontSize: 11, fontWeight: 700,
                  color: k.trend > 0 ? '#16A34A' : k.trend < 0 ? '#EF4444' : '#9CA3AF' }}>
                  {k.trend > 0 ? '↑' : k.trend < 0 ? '↓' : '→'}{Math.abs(k.trend)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Concurrent Call Stream chart (white card) ────────────────────── */}
      <div className="noc-fade-in" style={{ background: '#FFFFFF', borderRadius: 16,
        overflow: 'hidden', animationDelay: '200ms',
        transition: 'border 0.6s ease, box-shadow 0.6s ease',
        ...ratioGlow }}>
        {/* Chart header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity style={{ width: 15, height: 15, color: '#2563EB' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1F2937' }}>Concurrent Call Stream</span>
            <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 500, marginLeft: 2 }}>avg concurrent · not cumulative</span>
            {surgeDetected && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#FEF3C7',
                border: '1px solid #FDE68A', borderRadius: 6, padding: '2px 7px',
                fontSize: 10, fontWeight: 700, color: '#B45309', letterSpacing: '0.04em' }}>
                ▲ SURGE +{surgeDelta}
              </span>
            )}
            {isRecovering && !surgeDetected && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#F0FDF4',
                border: '1px solid #BBF7D0', borderRadius: 6, padding: '2px 7px',
                fontSize: 10, fontWeight: 700, color: '#15803D', letterSpacing: '0.04em' }}>
                ↓ RECOVERING {recoveryPct}%
              </span>
            )}
            {minsToCapacity !== null && minsToCapacity >= 0 && !surgeDetected && !isRecovering && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#FEF3C7',
                border: '1px solid #FCD34D', borderRadius: 6, padding: '2px 7px',
                fontSize: 10, fontWeight: 700, color: '#92400E', letterSpacing: '0.04em' }}>
                {minsToCapacity === 0 ? '⚡ AT CAPACITY' : `⚡ ~${minsToCapacity}m to cap`}
              </span>
            )}
            {latestConnectRatio !== null && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
                color: latestConnectRatio >= 0.8 ? '#16A34A' : latestConnectRatio >= 0.5 ? '#D97706' : '#DC2626',
                background: latestConnectRatio >= 0.8 ? '#F0FDF4' : latestConnectRatio >= 0.5 ? '#FFFBEB' : '#FEF2F2',
                border: `1px solid ${latestConnectRatio >= 0.8 ? '#BBF7D0' : latestConnectRatio >= 0.5 ? '#FDE68A' : '#FECACA'}`,
                borderRadius: 6, padding: '2px 7px',
              }}>
                {Math.round(latestConnectRatio * 100)}% connected
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11, color: '#9CA3AF' }}>
            {capacityRef > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: '#9CA3AF' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 16, height: 2, background: '#F59E0B', opacity: 0.6, display: 'inline-block', borderRadius: 1 }} />
                  <span>70% cap</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 16, height: 2, background: '#EF4444', opacity: 0.6, display: 'inline-block', borderRadius: 1 }} />
                  <span>90% cap</span>
                </span>
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 24, height: 2.5, background: '#16A34A', borderRadius: 2, display: 'inline-block' }} />Connected
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 24, height: 2.5, background: '#F59E0B', opacity: 0.7, borderRadius: 2, display: 'inline-block' }} />Routing
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 24, height: 0, borderTop: '2px dashed #2563EB', opacity: 0.4, display: 'inline-block' }} />Total Active
            </span>
            {projectedPoints.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 24, height: 0, borderTop: '2px dashed #D97706', opacity: 0.55, display: 'inline-block' }} />
                <span style={{ color: '#D97706', fontWeight: 600 }}>Projected</span>
              </span>
            )}
            {showEvents && hasEvents && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#D97706', fontWeight: 600 }}>
                <AlertCircle style={{ width: 12, height: 12 }} />{eventCount} events
              </span>
            )}
          </div>
        </div>

        {/* Quality Pressure Correlation hint — P5 behavior hint row */}
        {qualityPressureHint && (
          <div style={{ padding: '6px 20px', borderBottom: '1px solid #FEF3C7', background: '#FFFBEB',
            display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#92400E', opacity: 0.7,
              textTransform: 'uppercase', letterSpacing: '0.06em' }}>Behavior</span>
            <span style={{ fontSize: 11, color: '#B45309', fontWeight: 500 }}>{qualityPressureHint}</span>
          </div>
        )}

        {/* Chart body */}
        {concPoints.length === 0 && !concFetching ? (
          <div style={{ height: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 6, fontSize: 13, color: '#D1D5DB' }}>
            <Activity style={{ width: 24, height: 24, opacity: 0.3 }} />
            <span>No concurrent history yet — data builds up as calls are polled (60s interval)</span>
          </div>
        ) : concFetching && concPoints.length === 0 ? (
          <div style={{ height: 280, background: '#F9FAFB', animation: 'pulse 2s infinite' }} />
        ) : (
          <div style={{ padding: '16px 12px 12px', height: 300, position: 'relative' }}>
            {/* Live scan shimmer — subtle light beam sweeping left→right */}
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2,
              borderRadius: 8 }}>
              <div style={{
                position: 'absolute', top: 0, bottom: 0, width: '28%',
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)',
                animation: 'noc-chart-scan 7s ease-in-out infinite',
              }} />
            </div>
            {/* Live edge indicator — rightmost pulsing bar */}
            <div style={{ position: 'absolute', right: 12, top: 16, bottom: 12, width: 2,
              background: 'linear-gradient(180deg, transparent 0%, #16A34A 40%, #16A34A 60%, transparent 100%)',
              opacity: 0.18, borderRadius: 1, pointerEvents: 'none', zIndex: 2 }} />
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 22, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="lgConcConn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#16A34A" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#16A34A" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="lgConcRoute" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#F59E0B" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid horizontal vertical={false} stroke={GRID_COLOR} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={concTickInterval} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                <Tooltip content={<ConcurrentGraphTooltip />} cursor={chartCursor} />
                {/* ── Capacity threshold bands ── */}
                {capacityRef > 0 && (
                  <>
                    {/* Amber zone: 70%–90% of capacity */}
                    <ReferenceArea y1={capacitySoft} y2={capacityHard}
                      fill="#F59E0B" fillOpacity={0.06} ifOverflow="extendDomain" />
                    {/* Red zone: 90%–100% of capacity */}
                    <ReferenceArea y1={capacityHard} y2={capacityRef}
                      fill="#EF4444" fillOpacity={0.07} ifOverflow="extendDomain" />
                    {/* Soft threshold line */}
                    <ReferenceLine y={capacitySoft} stroke="#F59E0B" strokeWidth={1}
                      strokeDasharray="6 4" strokeOpacity={0.55}
                      label={{ value: `70%`, position: 'insideTopRight', fill: '#D97706', fontSize: 9, fontWeight: 700 }} />
                    {/* Hard threshold line */}
                    <ReferenceLine y={capacityHard} stroke="#EF4444" strokeWidth={1}
                      strokeDasharray="6 4" strokeOpacity={0.55}
                      label={{ value: `90%`, position: 'insideTopRight', fill: '#DC2626', fontSize: 9, fontWeight: 700 }} />
                  </>
                )}
                {showEvents && dedupedConcEvents.map((ev, i) => {
                  const cfg = EVENT_CONFIG[ev.type] ?? EVENT_CONFIG.incident;
                  return (
                    <ReferenceLine key={i} x={ev.concLabel}
                      stroke={cfg.stroke} strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.6}
                      label={<EventMarkerLabel event={ev} />} />
                  );
                })}
                {/* Routing calls — amber layer */}
                <Area type="monotone" dataKey="routing"
                  stroke="#F59E0B" strokeWidth={1.5} fill="url(#lgConcRoute)"
                  dot={(p: any) => <LatestPulseDot key={p.key} {...p} dataLength={concPoints.length} color="#F59E0B" />}
                  activeDot={{ r: 3.5, fill: '#F59E0B', stroke: '#fff', strokeWidth: 2 }}
                  strokeLinejoin="round" strokeLinecap="round" />
                {/* Connected — primary signal, green — carries the main pulse dot */}
                <Area type="monotone" dataKey="connected"
                  stroke="#16A34A" strokeWidth={2.5} fill="url(#lgConcConn)"
                  dot={(p: any) => <LatestPulseDot key={p.key} {...p} dataLength={concPoints.length} color="#16A34A" />}
                  activeDot={{ r: 4, fill: '#16A34A', stroke: '#fff', strokeWidth: 2 }}
                  strokeLinejoin="round" strokeLinecap="round" />
                {/* Total active — blue dashed reference line */}
                <Line type="monotone" dataKey="active"
                  stroke="#2563EB" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.45} dot={false}
                  activeDot={{ r: 3, fill: '#2563EB', stroke: '#fff', strokeWidth: 2 }} />
                {/* Saturation projection — faint dashed amber extrapolation */}
                {projectedPoints.length > 0 && (
                  <Line type="linear" dataKey="projected"
                    stroke="#D97706" strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.55}
                    dot={false} connectNulls={false}
                    activeDot={{ r: 3, fill: '#D97706', stroke: '#fff', strokeWidth: 2 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── ASR trend (white card) ─────────────────────────────────────────── */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E6EAF0', borderRadius: 16,
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 20px', borderBottom: '1px solid #F3F4F6' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1F2937' }}>Answer Success Rate</span>
          <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>per {bucket === 60 ? '1h' : `${bucket}m`} bucket</span>
          {s && (
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700,
              color: s.asr >= 60 ? '#16A34A' : s.asr >= 40 ? '#F59E0B' : '#EF4444' }}>
              Avg {s.asr}%
            </span>
          )}
        </div>
        {buckets.length > 0 && (
          <div style={{ padding: '12px 12px 10px', height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={buckets} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="lgAsr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#16A34A" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#16A34A" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid horizontal vertical={false} stroke={GRID_COLOR} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={tickInterval} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`}
                  tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  content={({ active, payload, label: lbl }: any) => {
                    if (!active || !payload?.length) return null;
                    const asr = payload[0]?.value ?? 0;
                    const c = asr >= 60 ? '#16A34A' : asr >= 40 ? '#F59E0B' : '#EF4444';
                    return (
                      <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 10,
                        padding: '8px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', fontSize: 12 }}>
                        <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 4 }}>{lbl}</div>
                        <div style={{ fontWeight: 700, color: c }}>ASR {asr}%</div>
                      </div>
                    );
                  }}
                  cursor={chartCursor}
                />
                {showEvents && dedupedEvents.map((ev, i) => {
                  const cfg = EVENT_CONFIG[ev.type] ?? EVENT_CONFIG.incident;
                  return (
                    <ReferenceLine key={i} x={ev.bucketLabel}
                      stroke={cfg.stroke} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.45} />
                  );
                })}
                <Area type="monotone" dataKey="asr"
                  stroke="#16A34A" strokeWidth={2} fill="url(#lgAsr)" dot={false}
                  activeDot={{ r: 3.5, fill: '#16A34A', stroke: '#fff', strokeWidth: 2 }}
                  strokeLinejoin="round" strokeLinecap="round" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Event Timeline (light card, intelligence-aware) ───────────────── */}
      {showEvents && visibleEvents.length > 0 && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E6EAF0', borderRadius: 16,
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)', overflow: 'hidden' }}>

          {/* Header with intelligence summary */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertCircle style={{ width: 14, height: 14, color: '#D97706', flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1F2937' }}>Event Intelligence</span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>{eventCount} events · {hoursBack}h window</span>
              {likelyCauseCount > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#FEE2E2',
                  border: '1px solid #FECACA', borderRadius: 99, padding: '2px 8px',
                  fontSize: 10, fontWeight: 800, color: '#B91C1C', letterSpacing: '0.04em' }}>
                  ⚡ {likelyCauseCount} likely cause{likelyCauseCount > 1 ? 's' : ''} detected
                </span>
              )}
              {/* Type pills */}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(EVENT_CONFIG).map(([type, cfg]) => {
                  const count = visibleEvents.filter(e => e.type === type).length;
                  if (!count) return null;
                  return (
                    <span key={type} className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold", cfg.badge)}>
                      {cfg.icon} {type.replace(/_/g,' ')} ({count})
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Event rows — sorted: likelyCause first, then newest */}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {[...visibleEvents]
              .sort((a, b) => {
                if (a.likelyCause !== b.likelyCause) return a.likelyCause ? -1 : 1;
                return b.ts - a.ts;
              })
              .map((ev, i) => {
                const cfg = EVENT_CONFIG[ev.type] ?? EVENT_CONFIG.incident;
                const time = new Date(ev.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                const sevClr = ev.severity === 'critical' ? { bg: '#FEE2E2', text: '#B91C1C', border: '#FECACA' }
                             : ev.severity === 'high'     ? { bg: '#FFEDD5', text: '#C2410C', border: '#FED7AA' }
                             : ev.severity === 'medium'   ? { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' }
                             :                              { bg: '#F3F4F6', text: '#6B7280', border: '#E5E7EB' };
                return (
                  <div key={i} data-testid={`event-row-${i}`}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 20px',
                      borderBottom: '1px solid #F9FAFB', transition: 'background 0.1s',
                      background: ev.likelyCause ? '#FFFBEB' : 'transparent',
                      borderLeft: ev.likelyCause ? `3px solid ${cfg.stroke}` : '3px solid transparent',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = ev.likelyCause ? '#FEF3C7' : '#F9FAFB')}
                    onMouseLeave={e => (e.currentTarget.style.background = ev.likelyCause ? '#FFFBEB' : 'transparent')}>

                    {/* Type icon */}
                    <span className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[11px] border font-bold flex-shrink-0 mt-0.5", cfg.badge)}>
                      {cfg.icon}
                    </span>

                    {/* Detail + metadata */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: ev.likelyCause ? 700 : 600, color: '#1F2937', margin: 0,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.detail}</p>
                      {/* Impact description — only shown when correlated */}
                      {ev.likelyCause && ev.impactDesc && (
                        <p style={{ fontSize: 11, color: cfg.stroke, margin: '2px 0 0', fontWeight: 600 }}>
                          ↳ {ev.impactDesc}
                        </p>
                      )}
                      <p style={{ fontSize: 10, color: '#9CA3AF', margin: '2px 0 0' }}>
                        {time} · {ev.type.replace(/_/g, ' ')}
                        {ev.score > 0 && (
                          <span style={{ marginLeft: 6, color: ev.likelyCause ? cfg.stroke : '#9CA3AF' }}>
                            · {ev.score}% correlation
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Right-side badges */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      {ev.likelyCause && (
                        <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
                          padding: '2px 7px', borderRadius: 99, background: cfg.stroke, color: '#fff' }}>
                          LIKELY CAUSE
                        </span>
                      )}
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                        padding: '2px 7px', borderRadius: 99, border: `1px solid ${sevClr.border}`,
                        background: sevClr.bg, color: sevClr.text }}>
                        {ev.severity}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── All-clear state ────────────────────────────────────────────────── */}
      {showEvents && visibleEvents.length === 0 && !evFetching && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12,
          padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, color: '#15803D', fontWeight: 500 }}>
          <Check style={{ width: 15, height: 15, color: '#16A34A', flexShrink: 0 }} />
          No incidents, routing changes, or alerts in the {hoursBack}h window
        </div>
      )}
    </div>
  );
}

// ── Analytics Dashboard (filter-driven, CDR cache only) ───────────────────────

interface AnalyticsKpis {
  totalCalls: number; answeredCalls: number;
  asr: number; acd: number; pdd: number;
  mos: number | null; mosGrade: string | null;
  ner: number | null; totalMinutes: number; totalCost: number;
}
interface AnalyticsTimeBucket { bucket: string; calls: number; answered: number; asr: number; minutes: number; cost: number; }
interface AnalyticsVendorRow  { vendor: string;  calls: number; answered: number; asr: number; minutes: number; cost: number; }
interface AnalyticsClientRow  { client: string;  calls: number; answered: number; asr: number; minutes: number; cost: number; }
interface AnalyticsDestRow    { country: string; calls: number; answered: number; asr: number; minutes: number; pct: number; }
interface AnalyticsDashboardResponse {
  kpis:            AnalyticsKpis;
  timeSeries:      AnalyticsTimeBucket[];
  topVendors:      AnalyticsVendorRow[];
  topClients:      AnalyticsClientRow[];
  topDestinations: AnalyticsDestRow[];
  breakout: { answered: number; failed: number; rna: number; networkFail: number; otherFailed: number };
  meta: { version: string; window: string; granularity: string; cdrCount: number; cacheSize: number; updatedAt: string | null; filtersApplied: Record<string, string | null> };
}

const WINDOW_OPTIONS = ['1h', '6h', '24h', '7d', '30d', '90d'] as const;
type WindowOption = typeof WINDOW_OPTIONS[number];

// Dimension Map — canonical mapping from filter contract → CDR fields (documented here, applied server-side)
// c_company_name → clientName / accountNameCache
// v_company_name → vendor / connectionVendorCache
// country        → country
// switch_name    → no-op (single-switch system)

function AnalyticsDashboardView() {
  const [win,      setWin]      = useState<WindowOption>('24h');
  const [fClient,  setFClient]  = useState('');
  const [fVendor,  setFVendor]  = useState('');
  const [fCountry, setFCountry] = useState('');

  // Applied state — only updates on explicit "Apply" (or Enter key)
  // UI never decides granularity — that lives in the API contract
  const [applied, setApplied] = useState({
    version: 'v1' as const,
    filters: { c_company_name: '', v_company_name: '', country: '' },
    time: { window: '24h' as WindowOption },
  });

  function handleApply() {
    setApplied({ version: 'v1', filters: { c_company_name: fClient.trim(), v_company_name: fVendor.trim(), country: fCountry.trim() }, time: { window: win } });
  }
  function handleReset() {
    setWin('24h'); setFClient(''); setFVendor(''); setFCountry('');
    setApplied({ version: 'v1', filters: { c_company_name: '', v_company_name: '', country: '' }, time: { window: '24h' } });
  }

  const { data, isLoading, isError, refetch } = useQuery<AnalyticsDashboardResponse>({
    queryKey: ['/api/analytics/dashboard', applied],
    queryFn: async () => {
      const r = await fetch('/api/analytics/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(applied),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  const kpis    = data?.kpis;
  const meta    = data?.meta;
  const breakout = data?.breakout;
  const topVendors = data?.topVendors ?? [];
  const topClients = data?.topClients ?? [];
  const topDests   = data?.topDestinations ?? [];

  // Format bucket timestamps server-side granularity is authoritative
  const chartData = (data?.timeSeries ?? []).map(b => {
    const d = new Date(b.bucket);
    const label = meta?.granularity === 'hourly'
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : meta?.granularity === '6h'
      ? `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.getHours().toString().padStart(2, '0')}h`
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { label, calls: b.calls, answered: b.answered };
  });

  const asrClr = (v: number) => v >= 65 ? '#16A34A' : v >= 50 ? '#D97706' : '#EF4444';
  const mosClr = (v: number) => v >= 4.0 ? '#16A34A' : v >= 3.5 ? '#D97706' : '#EF4444';
  const fmtAcd = (s: number) => s ? `${Math.floor(s / 60)}m ${s % 60}s` : '—';

  return (
    <div className="flex h-full overflow-hidden" data-testid="analytics-dashboard">

      {/* ── Filter sidebar — emits filter v1, no business logic ───────────── */}
      <div className="w-52 flex-shrink-0 border-r border-border/30 bg-muted/5 overflow-y-auto p-4 flex flex-col gap-5">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-3">Time Window</p>
          <div className="grid grid-cols-3 gap-1">
            {WINDOW_OPTIONS.map(w => (
              <button
                key={w}
                data-testid={`window-${w}`}
                onClick={() => setWin(w)}
                className={cn(
                  "px-1.5 py-1 rounded-md text-[10px] font-semibold border transition-all",
                  win === w
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                    : "border-border/25 text-muted-foreground/50 hover:border-amber-500/25 hover:text-amber-400/70"
                )}
              >{w}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Filters</p>
          {([
            { label: 'Client',  state: fClient,  set: setFClient,  placeholder: 'e.g. Tata', testid: 'filter-client' },
            { label: 'Vendor',  state: fVendor,  set: setFVendor,  placeholder: 'e.g. BICS', testid: 'filter-vendor' },
            { label: 'Country', state: fCountry, set: setFCountry, placeholder: 'e.g. PK',   testid: 'filter-country' },
          ] as const).map(f => (
            <div key={f.label}>
              <p className="text-[9px] text-muted-foreground/40 mb-1 font-semibold">{f.label}</p>
              <input
                data-testid={f.testid}
                value={f.state}
                onChange={e => f.set(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleApply()}
                placeholder={f.placeholder}
                className="w-full px-2.5 py-1.5 rounded-lg border border-border/30 bg-card text-xs text-foreground placeholder:text-muted-foreground/25 focus:outline-none focus:border-amber-500/40 transition-colors"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <button
            data-testid="btn-apply-filters"
            onClick={handleApply}
            className="w-full px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/25 transition-colors"
          >Apply</button>
          <button
            data-testid="btn-reset-filters"
            onClick={handleReset}
            className="w-full px-3 py-1.5 rounded-lg border border-border/25 text-muted-foreground/50 text-xs hover:text-foreground hover:border-border/50 transition-colors"
          >Reset</button>
        </div>

        <div className="flex flex-col gap-1.5 pt-1">
          <button
            onClick={() => refetch()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/25 text-muted-foreground/40 text-xs hover:text-foreground hover:border-border/50 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {meta && (
          <div className="mt-auto text-[9px] text-muted-foreground/25 leading-relaxed border-t border-border/15 pt-3">
            <p className="font-mono">{meta.cdrCount.toLocaleString()} CDRs matched</p>
            <p className="font-mono">Cache: {meta.cacheSize.toLocaleString()}</p>
            <p className="font-mono">Gran: {meta.granularity}</p>
            {meta.updatedAt && <p className="font-mono">Updated {new Date(meta.updatedAt).toLocaleTimeString()}</p>}
          </div>
        )}
      </div>

      {/* ── Dashboard renderer — consumes API response, zero business logic ── */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-muted/15 animate-pulse border border-border/20" />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && !isLoading && (
          <div className="flex items-center gap-2 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Failed to load analytics — check connection or retry
          </div>
        )}

        {kpis && !isLoading && (
          <>
            {/* ── KPI strip ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-5 gap-3">
              {([
                { label: 'Total Calls',   value: kpis.totalCalls.toLocaleString(),                           color: '#1F2937', sub: `${kpis.answeredCalls.toLocaleString()} answered` },
                { label: 'ASR',           value: `${kpis.asr}%`,                                             color: asrClr(kpis.asr), sub: kpis.ner != null ? `NER ${kpis.ner}%` : undefined },
                { label: 'ACD',           value: fmtAcd(kpis.acd),                                           color: '#2563EB', sub: undefined },
                { label: 'MOS',           value: kpis.mos != null ? kpis.mos.toFixed(2) : 'N/A',            color: kpis.mos != null ? mosClr(kpis.mos) : '#9CA3AF', sub: kpis.mosGrade ? `Grade ${kpis.mosGrade}` : undefined },
                { label: 'Total Cost',    value: `$${kpis.totalCost.toFixed(2)}`,                            color: '#1F2937', sub: `${kpis.totalMinutes.toFixed(0)} min` },
              ] as const).map((card, i) => (
                <div
                  key={i}
                  data-testid={`kpi-card-${i}`}
                  className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl shadow-sm p-4 flex flex-col gap-1"
                >
                  <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">{card.label}</span>
                  <span className="text-xl font-extrabold tabular-nums leading-none" style={{ color: card.color }}>{card.value}</span>
                  {card.sub && <span className="text-[10px] text-gray-400">{card.sub}</span>}
                </div>
              ))}
            </div>

            {/* ── Call disposition row ─────────────────────────────────────── */}
            {breakout && (
              <div className="flex items-center gap-4 px-4 py-2.5 bg-muted/5 border border-border/20 rounded-xl text-xs flex-wrap">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Disposition</span>
                {([
                  { label: 'Answered',     value: breakout.answered,    cls: 'text-emerald-400' },
                  { label: 'RNA',          value: breakout.rna,         cls: 'text-amber-400' },
                  { label: 'Network Fail', value: breakout.networkFail, cls: 'text-rose-400' },
                  { label: 'Other Failed', value: breakout.otherFailed, cls: 'text-rose-300' },
                ] as const).map((d, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/25">·</span>
                    <span className={cn("font-bold tabular-nums", d.cls)}>{d.value.toLocaleString()}</span>
                    <span className="text-muted-foreground/40">{d.label}</span>
                  </span>
                ))}
              </div>
            )}

            {/* ── Time series chart ────────────────────────────────────────── */}
            {chartData.length > 0 && (
              <div className="bg-card border border-border/25 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">
                    Call Volume · {applied.time.window} · {meta?.granularity ?? '—'}
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50">
                      <span className="w-4 h-0.5 rounded-full bg-amber-400 inline-block" />Total
                    </span>
                    <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50">
                      <span className="w-4 h-0.5 rounded-full bg-emerald-400 inline-block" />Answered
                    </span>
                  </div>
                </div>
                <div style={{ width: '100%', height: 160 }}>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                      <defs>
                        <linearGradient id="ae-grad-calls" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#f59e0b" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="ae-grad-ans" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#10b981" stopOpacity={0.30} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid horizontal vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="label" tick={{ fontSize: 8, fill: 'rgba(148,163,184,0.5)', fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 8, fill: 'rgba(148,163,184,0.5)', fontFamily: 'monospace' }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        cursor={{ stroke: 'rgba(148,163,184,0.15)', strokeWidth: 1.5, strokeDasharray: '4 2' }}
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload?.length) return null;
                          return (
                            <div className="rounded-xl border border-border/50 bg-card/95 backdrop-blur-md px-3 py-2 text-xs shadow-xl">
                              <p className="text-muted-foreground/50 font-mono mb-1.5">{label}</p>
                              {payload.map((p: any) => (
                                <div key={p.dataKey} className="flex items-center justify-between gap-4">
                                  <span className="text-muted-foreground/60">{p.dataKey === 'calls' ? 'Total' : 'Answered'}</span>
                                  <span className="font-bold tabular-nums" style={{ color: p.color }}>{p.value}</span>
                                </div>
                              ))}
                            </div>
                          );
                        }}
                      />
                      <Area type="monotone" dataKey="calls"    stroke="#f59e0b" strokeWidth={2}   fill="url(#ae-grad-calls)" dot={false} activeDot={{ r: 3.5, fill: '#f59e0b', stroke: 'hsl(var(--card))', strokeWidth: 2 }} />
                      <Area type="monotone" dataKey="answered" stroke="#10b981" strokeWidth={1.5} fill="url(#ae-grad-ans)"   dot={false} activeDot={{ r: 3,   fill: '#10b981', stroke: 'hsl(var(--card))', strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── Top tables ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-4">
              {([
                {
                  title: 'Top Vendors',
                  rows: topVendors.slice(0, 8),
                  nameKey: 'vendor' as const,
                  testPrefix: 'vendor',
                },
                {
                  title: 'Top Clients',
                  rows: topClients.slice(0, 8),
                  nameKey: 'client' as const,
                  testPrefix: 'client',
                },
              ] as const).map(({ title, rows, nameKey, testPrefix }) => (
                <div key={title} className="bg-card border border-border/25 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border/15">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">{title}</p>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/10 bg-muted/5">
                        <th className="px-3 py-1.5 text-left text-[9px] font-semibold text-muted-foreground/30 uppercase tracking-wider">Name</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-semibold text-muted-foreground/30">Calls</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-semibold text-muted-foreground/30">ASR</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-semibold text-muted-foreground/30">Min</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} data-testid={`row-${testPrefix}-${i}`} className="border-b border-border/8 hover:bg-muted/10 transition-colors">
                          <td className="px-3 py-1.5 font-medium truncate max-w-[100px]" title={r[nameKey]}>{r[nameKey]}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-mono text-foreground/70">{r.calls.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-mono font-semibold" style={{ color: asrClr(r.asr) }}>{r.asr}%</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-mono text-muted-foreground/40">{r.minutes.toFixed(0)}</td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground/25 text-[11px]">No data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ))}

              {/* Destinations */}
              <div className="bg-card border border-border/25 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/15">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Top Destinations</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/10 bg-muted/5">
                      <th className="px-3 py-1.5 text-left text-[9px] font-semibold text-muted-foreground/30 uppercase tracking-wider">Country</th>
                      <th className="px-3 py-1.5 text-right text-[9px] font-semibold text-muted-foreground/30">Calls</th>
                      <th className="px-3 py-1.5 text-right text-[9px] font-semibold text-muted-foreground/30">ASR</th>
                      <th className="px-3 py-1.5 text-right text-[9px] font-semibold text-muted-foreground/30">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topDests.slice(0, 8).map((r, i) => (
                      <tr key={i} data-testid={`row-dest-${i}`} className="border-b border-border/8 hover:bg-muted/10 transition-colors">
                        <td className="px-3 py-1.5 font-medium truncate max-w-[100px]" title={r.country}>{r.country}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-mono text-foreground/70">{r.calls.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-mono font-semibold" style={{ color: asrClr(r.asr) }}>{r.asr}%</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-mono text-muted-foreground/40">{r.pct}%</td>
                      </tr>
                    ))}
                    {topDests.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground/25 text-[11px]">No data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
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
  const [viewMode, setViewMode] = useState<'table' | 'graph' | 'dashboard'>('table');

  // ── Hierarchy panel selection — cascades to all graph queries ─────────────
  const [hierarchyKamId,     setHierarchyKamId]     = useState<number | null>(null);
  const [hierarchyAccountId, setHierarchyAccountId] = useState<number | null>(null);
  const [hierarchyAcctName,  setHierarchyAcctName]  = useState<string | null>(null);
  const [hierarchyDestName,  setHierarchyDestName]  = useState<string | null>(null);

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

  // ── KAM hierarchy tree — always fetched for the left HierarchyPanel ─────────
  // /api/kam returns KamNode[] directly (flat array, not wrapped)
  const { data: kamHierarchyData } = useQuery<KamNode[]>({
    queryKey: ['/api/kam'],
    queryFn: async () => {
      const r = await fetch('/api/kam');
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
  const kamHierarchyList = useMemo(() => kamHierarchyData ?? [], [kamHierarchyData]);

  // ── Account destinations — fetched when a client is selected in the hierarchy panel ──
  const { data: accountDestsData } = useQuery<{ destinations: DestEntry[] }>({
    queryKey: ['/api/bitseye/account-destinations', hierarchyAccountId],
    queryFn: async () => {
      const r = await fetch(`/api/bitseye/account-destinations?accountId=${hierarchyAccountId}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!hierarchyAccountId,
    staleTime: 2 * 60_000,
    refetchInterval: 3 * 60_000,
  });
  const hierarchyDests = useMemo(() => accountDestsData?.destinations ?? [], [accountDestsData]);

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

      {/* ── Left Hierarchy Panel ─────────────────────────────────────── */}
      <HierarchyPanel
        kams={kamHierarchyList}
        selectedKamId={hierarchyKamId}
        selectedAccountId={hierarchyAccountId}
        destinations={hierarchyDests}
        selectedDestName={hierarchyDestName}
        onSelectKam={kam => {
          setHierarchyKamId(kam.id);
          setHierarchyAccountId(null);
          setHierarchyAcctName(null);
          setHierarchyDestName(null);
          setNav(prev => ({ ...prev, kamId: kam.id, kamName: kam.name, type: 'kam' }));
        }}
        onSelectClient={(accountId, name, kamId) => {
          setHierarchyAccountId(accountId);
          setHierarchyAcctName(name);
          setHierarchyKamId(kamId);
          setHierarchyDestName(null);
          setViewMode('graph');
        }}
        onClearClient={() => {
          setHierarchyAccountId(null);
          setHierarchyAcctName(null);
          setHierarchyDestName(null);
        }}
        onSelectDest={name => {
          setHierarchyDestName(name);
          setViewMode('graph');
        }}
        onClearDest={() => setHierarchyDestName(null)}
      />

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
            <button
              data-testid="btn-view-dashboard"
              onClick={() => setViewMode('dashboard')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                viewMode === 'dashboard'
                  ? "bg-card text-amber-400 shadow-sm border border-amber-500/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <PieChart className="w-3.5 h-3.5" />
              Dashboard
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
        <div className={cn("flex-1 overflow-hidden", viewMode === 'dashboard' ? "overflow-hidden" : "overflow-y-auto p-5")}>
          {viewMode === 'dashboard' ? (
            /* Analytics Dashboard — filter v1 → CDR cache → KPI + charts + tables */
            <AnalyticsDashboardView />
          ) : viewMode === 'graph' && hierarchyAccountId ? (
            /* Specific client selected → full NOC intelligence chart */
            <BitsEyeGraphView
              kamId={null}
              accountId={hierarchyAccountId}
              accountName={hierarchyAcctName}
              destFilter={hierarchyDestName}
            />
          ) : viewMode === 'graph' && showGrid && contentEntities.length > 0 ? (
            /* Graph tab on a list view → same sparkline-card grid */
            <div className="space-y-5">
              <div className="flex items-center gap-4 pb-3 border-b border-border/20">
                <span className="text-xs text-muted-foreground/50">{contentEntities.length} {
                  nav.type === 'clients-all' || nav.type === 'kam' ? 'clients'
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
                <span className={cn("text-xs font-semibold", asrColor(
                  Math.round(contentEntities.reduce((s, e) => s + e.todayCalls * e.asr, 0) /
                    Math.max(contentEntities.reduce((s, e) => s + e.todayCalls, 0), 1))
                ))}>
                  ASR {Math.round(contentEntities.reduce((s, e) => s + e.todayCalls * e.asr, 0) /
                    Math.max(contentEntities.reduce((s, e) => s + e.todayCalls, 0), 1))}%
                </span>
                {nav.kamName && (
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] text-violet-400/60 bg-violet-500/5 border border-violet-500/15 px-2 py-0.5 rounded-full">
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
          ) : viewMode === 'graph' ? (
            /* Graph tab with no specific context — show full NOC dashboard */
            <BitsEyeGraphView
              kamId={hierarchyKamId}
              accountId={null}
              accountName={null}
              destFilter={null}
            />
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
