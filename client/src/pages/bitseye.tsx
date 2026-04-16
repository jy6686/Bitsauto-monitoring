import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  RefreshCw, ChevronRight, ChevronDown, BarChart3, WifiOff,
  TrendingUp, TrendingDown, Minus, AlertCircle, Globe, Users,
  Network, Layers, FolderOpen, Folder,
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
  | 'country-agg' | 'country-all' | 'country'
  | 'country-clients' | 'country-vendors'
  | 'kam-agg' | 'kam-all' | 'kam'
  | 'dest-agg' | 'dest-all' | 'dest';

interface NavState {
  type: NavType;
  country?: string;
  kamName?: string;
  destName?: string;
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
    total_calls: 'Total', connected_calls: 'Connected', concurrent_calls: 'Live',
  };
  return (
    <div className="rounded-lg border border-border/60 bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-xl z-50">
      <p className="font-medium text-muted-foreground mb-1.5 truncate max-w-[180px]">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }}>{labelMap[p.dataKey] ?? p.dataKey}</span>
          <span className="font-mono font-semibold text-foreground">{p.value}</span>
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
    ? data.filter((_, i) => i % Math.ceil(data.length / 8) === 0).map(d => d.label)
    : data.map(d => d.label);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">{title}</p>
      {!hasData ? (
        <div className="h-44 flex items-center justify-center border border-dashed border-border/20 rounded-xl text-xs text-muted-foreground/25">
          No data
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', height: 176 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 8, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientA} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={colorA} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={colorA} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id={gradientB} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={colorB} stopOpacity={0.20} />
                    <stop offset="95%" stopColor={colorB} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.15)" />
                <XAxis
                  dataKey="label"
                  ticks={ticks}
                  tick={{ fontSize: 7, fill: 'hsl(var(--muted-foreground)/0.5)' }}
                  tickLine={false} axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 7, fill: 'hsl(var(--muted-foreground)/0.5)' }}
                  tickLine={false} axisLine={false}
                  allowDecimals={false} width={26}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone" dataKey={keyA}
                  stroke={colorA} strokeWidth={2}
                  fill={`url(#${gradientA})`}
                  dot={false} activeDot={{ r: 3 }}
                />
                <Area
                  type="monotone" dataKey={keyB}
                  stroke={colorB} strokeWidth={1.5}
                  fill={`url(#${gradientB})`}
                  dot={false} activeDot={{ r: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 px-0.5">
        <span className="flex items-center gap-1 text-[8px] text-muted-foreground/50">
          <span className="w-3.5 h-0.5 rounded inline-block" style={{ backgroundColor: colorA }} />{labelA}
        </span>
        <span className="flex items-center gap-1 text-[8px] text-muted-foreground/50">
          <span className="w-3.5 h-0.5 rounded inline-block" style={{ backgroundColor: colorB }} />{labelB}
        </span>
      </div>
    </div>
  );
}

// ── Stats table ───────────────────────────────────────────────────────────────
function StatVal({ v }: { v: number }) {
  return (
    <td className="px-2 py-1 text-right text-[11px] tabular-nums">
      {v === 0 ? <span className="text-muted-foreground/20">-</span> : <span className="text-foreground/80">{v}</span>}
    </td>
  );
}
function StatsTable({ entity }: { entity: EntityData }) {
  return (
    <table className="w-full text-xs border-t border-border/20 mt-2">
      <thead>
        <tr>
          <th className="px-2 py-1 text-left text-[9px] font-normal text-muted-foreground/30 w-36" />
          {(['Cur','Min','Max','Avg'] as const).map(h => (
            <th key={h} className="px-2 py-1 text-right text-[9px] font-semibold text-muted-foreground/40">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-border/10">
          <td className="px-2 py-1 text-[10px] font-medium text-violet-400/80">Total_Calls</td>
          <StatVal v={entity.stats.total.cur} /><StatVal v={entity.stats.total.min} />
          <StatVal v={entity.stats.total.max} /><StatVal v={entity.stats.total.avg} />
        </tr>
        <tr className="border-t border-border/10">
          <td className="px-2 py-1 text-[10px] font-medium text-sky-400/80">Connected_Calls</td>
          <StatVal v={entity.stats.connected.cur} /><StatVal v={entity.stats.connected.min} />
          <StatVal v={entity.stats.connected.max} /><StatVal v={entity.stats.connected.avg} />
        </tr>
      </tbody>
      <tfoot>
        <tr className="border-t border-border/15">
          <td colSpan={3} className="px-2 pt-1 pb-0.5 text-[9px] text-muted-foreground/30">Last Updated</td>
          <td className="px-2 pt-1 pb-0.5 text-right text-[9px] tabular-nums text-muted-foreground/30">{entity.lastUpdatedAt}</td>
          <td className="px-2 pt-1 pb-0.5 text-right text-[9px] tabular-nums text-muted-foreground/30">{entity.lastUpdatedDate}</td>
        </tr>
      </tfoot>
    </table>
  );
}

// ── Single entity panel (full size) ──────────────────────────────────────────
function EntityPanel({ entity, dimmed }: { entity: EntityData; dimmed?: boolean }) {
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
      <div className="p-4 grid grid-cols-2 gap-5">
        <LargeChart
          data={entity.daily}
          title="Daily (24h)"
          gradientA={`dT_${uid}`} gradientB={`dC_${uid}`}
          colorA="#8b5cf6" colorB="#38bdf8"
          keyA="total_calls" keyB="connected_calls"
          labelA="total" labelB="connected"
        />
        <LargeChart
          data={entity.weekly}
          title="Weekly (7d)"
          gradientA={`wT_${uid}`} gradientB={`wC_${uid}`}
          colorA="#f59e0b" colorB="#14b8a6"
          keyA="total_calls" keyB="connected_calls"
          labelA="total" labelB="connected"
        />
      </div>

      {/* Stats table */}
      <div className="px-4 pb-4"><StatsTable entity={entity} /></div>

      {/* KAM client pills */}
      {entity.clients && entity.clients.length > 0 && (
        <div className="px-4 pb-3 border-t border-border/15 pt-2 flex flex-wrap gap-1.5">
          {entity.clients.slice(0, 8).map(c => (
            <span key={c} className="text-[9px] px-2 py-0.5 rounded-full bg-muted/30 border border-border/25 text-muted-foreground/50">{c}</span>
          ))}
          {entity.clients.length > 8 && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-muted/30 border border-border/25 text-muted-foreground/35">+{entity.clients.length - 8} more</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sidebar tree items ────────────────────────────────────────────────────────
function SidebarItem({
  label, selected, active, indent = 0, icon, onClick,
  hasChildren, expanded, badge, live,
}: {
  label: string;
  selected?: boolean;
  active?: boolean;
  indent?: number;
  icon?: React.ReactNode;
  onClick?: () => void;
  hasChildren?: boolean;
  expanded?: boolean;
  badge?: number;
  live?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`nav-${label.replace(/\s+/g, '-').toLowerCase()}`}
      className={cn(
        "flex items-center gap-1.5 w-full text-left rounded-lg transition-colors py-1.5 pr-2 group",
        indent === 0 ? "px-2" : indent === 1 ? "pl-5 pr-2" : indent === 2 ? "pl-8 pr-2" : "pl-11 pr-2",
        selected
          ? "bg-amber-500/15 text-amber-300 border border-amber-500/20"
          : active
            ? "bg-muted/30 text-foreground"
            : "text-muted-foreground hover:bg-muted/20 hover:text-foreground",
      )}
    >
      {live && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
      )}
      {!live && icon && <span className="flex-shrink-0 opacity-50">{icon}</span>}
      <span className="flex-1 truncate text-[11px] font-medium">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[8px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground/50 flex-shrink-0 font-mono">{badge}</span>
      )}
      {hasChildren && (
        <span className="flex-shrink-0 opacity-30">
          {expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
        </span>
      )}
    </button>
  );
}

// ── Sidebar category divider ──────────────────────────────────────────────────
function SidebarSection({ label }: { label: string }) {
  return (
    <div className="px-2 pt-3 pb-0.5">
      <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/30">{label}</p>
    </div>
  );
}

// ── Sub-category placeholder item ─────────────────────────────────────────────
function SubCatItem({
  label, selected, indent = 1, onClick, expandable, expanded, badge, icon,
}: {
  label: string; selected?: boolean; indent?: number; onClick?: () => void;
  expandable?: boolean; expanded?: boolean; badge?: number; icon?: React.ReactNode;
}) {
  return (
    <SidebarItem
      label={label}
      selected={selected}
      indent={indent}
      onClick={onClick}
      hasChildren={expandable}
      expanded={expanded}
      badge={badge}
      icon={icon}
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BitsEyePage() {
  const { role } = useAuth();
  const isViewer = role === 'viewer';

  // ── Nav state ─────────────────────────────────────────────────────────────
  const [nav, setNav] = useState<NavState>({ type: 'welcome' });
  // Sidebar expansion state
  const [expandedCountry,     setExpandedCountry]     = useState<string | null>(null);
  const [countryOpenCat,      setCountryOpenCat]      = useState<string | null>(null); // 'kam'|'destination'|null
  const [expandedKam,         setExpandedKam]         = useState<string | null>(null);
  const [kamOpenCat,          setKamOpenCat]          = useState<string | null>(null); // 'destination'|null
  const [sidebarOpen,         setSidebarOpen]         = useState(true);
  const [lastRefresh,         setLastRefresh]         = useState(Date.now());

  // ── Determine active country/KAM for data fetching ────────────────────────
  const activeCountry = expandedCountry ?? nav.country ?? '';
  const activeKam     = expandedKam ?? nav.kamName ?? '';

  // ── Data queries ─────────────────────────────────────────────────────────
  // Countries list (always fetched; used both for sidebar and country-level content)
  const { data: countriesData, isFetching: fetchingCountries, refetch: refetchCountries } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'countries', lastRefresh],
      queryFn: async () => {
        const r = await fetch('/api/bitseye/per-entity?category=countries&aliveOnly=false&orderBy=name');
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      staleTime: 20_000,
      refetchInterval: 60_000,
    });

  // KAMs — fetched when a country is expanded or KAM category is open
  const fetchKams = !!activeCountry || nav.type.startsWith('kam');
  const { data: kamsData, isFetching: fetchingKams } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'kam', activeCountry, lastRefresh],
      queryFn: async () => {
        const p = new URLSearchParams({ category: 'kam', aliveOnly: 'false', orderBy: 'name' });
        if (activeCountry) p.set('countryFilter', activeCountry);
        const r = await fetch(`/api/bitseye/per-entity?${p}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      enabled: fetchKams,
      staleTime: 20_000,
      refetchInterval: 60_000,
    });

  // Destinations — fetched when a KAM is expanded or dest category is open
  const fetchDests = !!activeKam || nav.type.startsWith('dest');
  const { data: destsData, isFetching: fetchingDests } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'destinations', activeCountry, activeKam, lastRefresh],
      queryFn: async () => {
        const p = new URLSearchParams({ category: 'destinations', aliveOnly: 'false', orderBy: 'name' });
        if (activeCountry) p.set('countryFilter', activeCountry);
        if (activeKam)     p.set('kamFilter', activeKam);
        const r = await fetch(`/api/bitseye/per-entity?${p}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      enabled: fetchDests,
      staleTime: 20_000,
      refetchInterval: 60_000,
    });

  // Clients under a KAM — shown when countryCategory='clients' or kamCategory='clients'
  const fetchClients = (countryOpenCat === 'clients' || kamOpenCat === 'clients') ||
    nav.type === 'country-clients' || nav.type === 'country-vendors';
  const { data: clientsData, isFetching: fetchingClients } =
    useQuery<PerEntityResponse>({
      queryKey: ['/api/bitseye/per-entity', 'clients', activeCountry, activeKam, lastRefresh],
      queryFn: async () => {
        const p = new URLSearchParams({ category: 'clients', aliveOnly: 'false', orderBy: 'name' });
        if (activeCountry) p.set('countryFilter', activeCountry);
        if (activeKam)     p.set('kamFilter', activeKam);
        const r = await fetch(`/api/bitseye/per-entity?${p}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      enabled: fetchClients,
      staleTime: 20_000,
    });

  const vendorsData = clientsData; // same structure; reuse for vendors category

  // ── Sidebar entity lists ──────────────────────────────────────────────────
  const countries  = useMemo(() => countriesData?.entities ?? [], [countriesData]);
  const kams       = useMemo(() => kamsData?.entities ?? [], [kamsData]);
  const dests      = useMemo(() => destsData?.entities ?? [], [destsData]);

  // ── Main content derivation ───────────────────────────────────────────────
  const { contentEntities, contentTitle, isFetchingContent } = useMemo(() => {
    switch (nav.type) {
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
        return { contentEntities: clientsData?.entities ?? [], contentTitle: `${nav.country} — Clients`, isFetchingContent: fetchingClients };
      case 'country-vendors':
        return { contentEntities: clientsData?.entities ?? [], contentTitle: `${nav.country} — Vendors`, isFetchingContent: fetchingClients };
      case 'kam-agg': {
        const agg = aggregateEntities(kams);
        return { contentEntities: agg ? [agg] : [], contentTitle: 'All KAMs — Aggregated', isFetchingContent: fetchingKams };
      }
      case 'kam-all':
        return { contentEntities: kams, contentTitle: 'All KAMs', isFetchingContent: fetchingKams };
      case 'kam': {
        const e = kams.find(k => k.name === nav.kamName);
        return { contentEntities: e ? [e] : [], contentTitle: nav.kamName ?? '', isFetchingContent: fetchingKams };
      }
      case 'dest-agg': {
        const agg = aggregateEntities(dests);
        return { contentEntities: agg ? [agg] : [], contentTitle: 'All Destinations — Aggregated', isFetchingContent: fetchingDests };
      }
      case 'dest-all':
        return { contentEntities: dests, contentTitle: 'All Destinations', isFetchingContent: fetchingDests };
      case 'dest': {
        const e = dests.find(d => d.name === nav.destName);
        return { contentEntities: e ? [e] : [], contentTitle: nav.destName ?? '', isFetchingContent: fetchingDests };
      }
      default:
        return { contentEntities: [], contentTitle: 'BitsEye', isFetchingContent: false };
    }
  }, [nav, countries, kams, dests, clientsData, fetchingCountries, fetchingKams, fetchingDests, fetchingClients]);

  // Show all="grid" or single="panel"
  const showGrid = nav.type === 'country-all' || nav.type === 'kam-all' || nav.type === 'dest-all' ||
    nav.type === 'country-clients' || nav.type === 'country-vendors';

  // ── Handlers ──────────────────────────────────────────────────────────────
  function selectCountry(name: string) {
    setExpandedCountry(prev => prev === name ? null : name);
    setCountryOpenCat(null);
    setExpandedKam(null);
    setKamOpenCat(null);
    setNav({ type: 'country', country: name });
  }
  function toggleCountryCat(cat: string, country: string) {
    if (countryOpenCat === cat) {
      setCountryOpenCat(null);
    } else {
      setCountryOpenCat(cat);
      if (cat === 'kam') setNav({ type: 'kam-all', country });
      else if (cat === 'clients') setNav({ type: 'country-clients', country });
      else if (cat === 'vendors') setNav({ type: 'country-vendors', country });
      else if (cat === 'destination') setNav({ type: 'dest-all', country });
    }
  }
  function selectKam(name: string, country: string) {
    setExpandedKam(prev => prev === name ? null : name);
    setKamOpenCat(null);
    setNav({ type: 'kam', country, kamName: name });
  }
  function toggleKamCat(cat: string, country: string, kamName: string) {
    if (kamOpenCat === cat) {
      setKamOpenCat(null);
    } else {
      setKamOpenCat(cat);
      if (cat === 'destination') setNav({ type: 'dest-all', country, kamName });
    }
  }
  function selectDest(name: string, country: string, kamName?: string) {
    setNav({ type: 'dest', country, kamName, destName: name });
  }

  function doRefresh() {
    setLastRefresh(Date.now());
  }

  const isFetchingAny = fetchingCountries || fetchingKams || fetchingDests || fetchingClients;

  return (
    <div className="flex h-full min-h-screen bg-background overflow-hidden">

      {/* ── Left Sidebar ─────────────────────────────────────────────── */}
      <aside className={cn(
        "flex-shrink-0 border-r border-border/30 bg-card/20 flex flex-col overflow-hidden transition-all duration-200",
        sidebarOpen ? "w-56" : "w-0",
      )}>
        {/* Sidebar header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/25 bg-card/40 flex-shrink-0">
          <Globe className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 flex-1">Country</p>
          {(fetchingCountries || fetchingKams || fetchingDests) && (
            <RefreshCw className="w-2.5 h-2.5 text-muted-foreground/30 animate-spin flex-shrink-0" />
          )}
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-px">
          {/* All Aggregated */}
          <SidebarItem
            label="All Aggregated"
            selected={nav.type === 'country-agg'}
            indent={0}
            badge={countries.length}
            onClick={() => { setNav({ type: 'country-agg' }); }}
          />
          {/* All */}
          <SidebarItem
            label="All"
            selected={nav.type === 'country-all'}
            indent={0}
            onClick={() => { setNav({ type: 'country-all' }); }}
          />

          {/* Country list */}
          {countries.length === 0 && !fetchingCountries && (
            <p className="text-[9px] text-muted-foreground/25 px-2 py-2">No data yet</p>
          )}
          {countries.map(country => {
            const isExpanded = expandedCountry === country.name;
            return (
              <div key={country.name}>
                <SidebarItem
                  label={country.name}
                  selected={nav.type === 'country' && nav.country === country.name}
                  active={isExpanded}
                  indent={0}
                  live={country.curConcurrent > 0}
                  hasChildren
                  expanded={isExpanded}
                  onClick={() => selectCountry(country.name)}
                />
                {isExpanded && (
                  <div className="space-y-px mt-0.5">
                    <SubCatItem
                      label="Clients"
                      indent={1}
                      selected={nav.type === 'country-clients' && nav.country === country.name}
                      icon={<Users className="w-3 h-3" />}
                      onClick={() => toggleCountryCat('clients', country.name)}
                    />
                    <SubCatItem
                      label="Vendors"
                      indent={1}
                      selected={nav.type === 'country-vendors' && nav.country === country.name}
                      icon={<Network className="w-3 h-3" />}
                      onClick={() => toggleCountryCat('vendors', country.name)}
                    />
                    {/* KAM sub-tree */}
                    <SubCatItem
                      label="KAM"
                      indent={1}
                      expandable
                      expanded={countryOpenCat === 'kam'}
                      icon={<Layers className="w-3 h-3" />}
                      badge={kams.length || undefined}
                      onClick={() => toggleCountryCat('kam', country.name)}
                    />
                    {countryOpenCat === 'kam' && (
                      <div className="space-y-px">
                        <SidebarItem label="All Aggregated" indent={2}
                          selected={nav.type === 'kam-agg' && nav.country === country.name}
                          onClick={() => setNav({ type: 'kam-agg', country: country.name })}
                        />
                        <SidebarItem label="All" indent={2}
                          selected={nav.type === 'kam-all' && nav.country === country.name}
                          onClick={() => setNav({ type: 'kam-all', country: country.name })}
                        />
                        {kams.map(kam => {
                          const kamExpanded = expandedKam === kam.name;
                          return (
                            <div key={kam.name}>
                              <SidebarItem
                                label={kam.name}
                                indent={2}
                                live={kam.curConcurrent > 0}
                                selected={nav.type === 'kam' && nav.kamName === kam.name}
                                active={kamExpanded}
                                hasChildren
                                expanded={kamExpanded}
                                onClick={() => selectKam(kam.name, country.name)}
                              />
                              {kamExpanded && (
                                <div className="space-y-px">
                                  <SubCatItem label="Destination" indent={3}
                                    expandable
                                    expanded={kamOpenCat === 'destination'}
                                    icon={<FolderOpen className="w-3 h-3" />}
                                    badge={dests.length || undefined}
                                    onClick={() => toggleKamCat('destination', country.name, kam.name)}
                                  />
                                  {kamOpenCat === 'destination' && (
                                    <div className="space-y-px">
                                      <SidebarItem label="All Aggregated" indent={3}
                                        selected={nav.type === 'dest-agg' && nav.kamName === kam.name}
                                        onClick={() => setNav({ type: 'dest-agg', country: country.name, kamName: kam.name })}
                                      />
                                      <SidebarItem label="All" indent={3}
                                        selected={nav.type === 'dest-all' && nav.kamName === kam.name}
                                        onClick={() => setNav({ type: 'dest-all', country: country.name, kamName: kam.name })}
                                      />
                                      {dests.map(dest => (
                                        <SidebarItem
                                          key={dest.name}
                                          label={dest.destBreakout || dest.name}
                                          indent={3}
                                          live={dest.curConcurrent > 0}
                                          selected={nav.type === 'dest' && nav.destName === dest.name}
                                          onClick={() => selectDest(dest.name, country.name, kam.name)}
                                        />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Destination sub-tree (direct under country) */}
                    <SubCatItem
                      label="Destination"
                      indent={1}
                      expandable
                      expanded={countryOpenCat === 'destination'}
                      icon={<Folder className="w-3 h-3" />}
                      onClick={() => toggleCountryCat('destination', country.name)}
                    />
                    {countryOpenCat === 'destination' && (
                      <div className="space-y-px">
                        <SidebarItem label="All Aggregated" indent={2}
                          selected={nav.type === 'dest-agg' && !nav.kamName && nav.country === country.name}
                          onClick={() => setNav({ type: 'dest-agg', country: country.name })}
                        />
                        <SidebarItem label="All" indent={2}
                          selected={nav.type === 'dest-all' && !nav.kamName && nav.country === country.name}
                          onClick={() => setNav({ type: 'dest-all', country: country.name })}
                        />
                        {destsData?.entities.map(dest => (
                          <SidebarItem
                            key={dest.name}
                            label={dest.destBreakout || dest.name}
                            indent={2}
                            live={dest.curConcurrent > 0}
                            selected={nav.type === 'dest' && nav.destName === dest.name && !nav.kamName}
                            onClick={() => selectDest(dest.name, country.name)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-card/60 backdrop-blur-xl flex-shrink-0">
          <button
            data-testid="btn-toggle-sidebar"
            onClick={() => setSidebarOpen(v => !v)}
            className="p-1.5 rounded-lg hover:bg-muted/40 text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            {sidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 rotate-90" />}
          </button>

          <div className="flex items-center gap-2">
            <div className="bg-amber-500/15 border border-amber-500/20 p-1.5 rounded-lg">
              <BarChart3 className="w-4 h-4 text-amber-400" />
            </div>
            <div className="leading-tight">
              <span className="text-sm font-bold">BitsEye</span>
              <span className="ml-2 text-xs text-muted-foreground/40 font-medium truncate">{contentTitle}</span>
            </div>
          </div>

          {/* Breadcrumb */}
          {nav.country && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/40 ml-2">
              <ChevronRight className="w-3 h-3" />
              <button
                className="hover:text-foreground transition-colors"
                onClick={() => setNav({ type: 'country', country: nav.country })}
              >{nav.country}</button>
              {nav.kamName && (
                <>
                  <ChevronRight className="w-3 h-3" />
                  <button
                    className="hover:text-foreground transition-colors"
                    onClick={() => setNav({ type: 'kam', country: nav.country, kamName: nav.kamName })}
                  >{nav.kamName}</button>
                </>
              )}
              {nav.destName && (
                <>
                  <ChevronRight className="w-3 h-3" />
                  <span className="text-muted-foreground/60 truncate max-w-[140px]">{nav.destName}</span>
                </>
              )}
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

          <button
            data-testid="btn-refresh"
            onClick={doRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/60 transition-colors text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetchingAny && "animate-spin")} />
            Refresh
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-5">
          {nav.type === 'welcome' ? (
            /* Welcome screen */
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
              <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl">
                <BarChart3 className="w-10 h-10 text-amber-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">BitsEye Analytics</h2>
                <p className="text-sm text-muted-foreground/50 mt-2 max-w-xs">
                  Select a country from the sidebar to drill into call traffic by KAM and destination.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                {[
                  { label: 'Countries', value: countries.length, icon: <Globe className="w-4 h-4" /> },
                  { label: 'KAMs', value: '-', icon: <Users className="w-4 h-4" /> },
                  { label: 'Destinations', value: '-', icon: <Layers className="w-4 h-4" /> },
                ].map(item => (
                  <div key={item.label} className="bg-card border border-border/30 rounded-xl px-6 py-4 flex flex-col items-center gap-1">
                    <span className="text-muted-foreground/40">{item.icon}</span>
                    <span className="text-lg font-bold">{item.value}</span>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/40">{item.label}</span>
                  </div>
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
              </div>
            </div>
          ) : showGrid ? (
            /* Grid of entity panels */
            <div className="space-y-5">
              {/* Summary bar */}
              <div className="flex items-center gap-4 pb-3 border-b border-border/20">
                <span className="text-xs text-muted-foreground/50">{contentEntities.length} entities</span>
                <span className="text-xs text-muted-foreground/30">·</span>
                <span className="text-xs text-muted-foreground/50">
                  {contentEntities.reduce((s, e) => s + e.todayCalls, 0)} calls today
                </span>
                <span className="text-xs text-muted-foreground/30">·</span>
                <span className={cn("text-xs", asrColor(
                  Math.round(contentEntities.reduce((s, e) => s + e.todayCalls * e.asr, 0) /
                    Math.max(contentEntities.reduce((s, e) => s + e.todayCalls, 0), 1))
                ))}>
                  ASR {Math.round(contentEntities.reduce((s, e) => s + e.todayCalls * e.asr, 0) /
                    Math.max(contentEntities.reduce((s, e) => s + e.todayCalls, 0), 1))}%
                </span>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {contentEntities.map(entity => (
                  <EntityPanel key={entity.name} entity={entity} />
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
