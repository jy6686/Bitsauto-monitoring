import { useRef, useCallback, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  RefreshCw, ChevronRight, Wifi, WifiOff, BarChart3,
  TrendingUp, TrendingDown, Minus, AlertCircle, Shield,
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtAcd(secs: number): string {
  if (!secs) return '-';
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}
function trendBg(pct: number) {
  if (pct >  10) return 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400';
  if (pct < -10) return 'bg-rose-500/10    border-rose-500/25    text-rose-400';
  return              'bg-amber-500/10   border-amber-500/25   text-amber-400';
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
function asrColor(asr: number) {
  if (asr >= 60) return 'text-emerald-400';
  if (asr >= 40) return 'text-amber-400';
  if (asr > 0)   return 'text-rose-400';
  return 'text-muted-foreground/30';
}
function cardBorder(entity: EntityData) {
  if (entity.trendPct < -20)                         return 'border-rose-500/30';
  if (entity.curConcurrent > 0 && entity.trendPct > 10) return 'border-emerald-500/35';
  if (entity.curConcurrent > 0)                      return 'border-blue-500/25';
  return 'border-border/40';
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const labelMap: Record<string, string> = {
    total_calls: 'Total', connected_calls: 'Connected', concurrent_calls: 'Live Concurrent',
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

// ── Mini chart ────────────────────────────────────────────────────────────────
function MiniChart({
  data, span, asr, showConcurrent,
}: {
  data: DailyPoint[] | WeeklyPoint[];
  span: 'Daily' | 'Weekly';
  asr: number;
  showConcurrent?: boolean;
}) {
  const pts    = data as any[];
  const hasData = pts.some((d: any) => d.total_calls > 0 || (showConcurrent && d.concurrent_calls > 0));
  const peakTotal  = Math.max(...pts.map((d: any) => d.total_calls), 0);
  const peakConc   = showConcurrent ? Math.max(...pts.map((d: any) => d.concurrent_calls ?? 0), 0) : 0;
  const ticks = span === 'Daily'
    ? pts.filter((_: any, i: number) => i % 8 === 0).map((d: any) => d.label)
    : pts.map((d: any) => d.label);

  return (
    <div className="flex flex-col gap-1 w-full overflow-hidden">
      <div className="flex items-center justify-between px-0.5">
        <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground/60">{span}</p>
        {asr > 0 && (
          <span className={cn("text-[9px] font-semibold tabular-nums", asrColor(asr))}>ASR {asr}%</span>
        )}
      </div>

      {!hasData ? (
        <div className="h-24 flex items-center justify-center text-[10px] text-muted-foreground/25 border border-dashed border-border/25 rounded-lg">
          No data
        </div>
      ) : (
        /* Use position:relative + absolute inner div so browser calculates width before Recharts mounts */
        <div style={{ position: 'relative', width: '100%', height: 96 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pts} margin={{ top: 4, right: 8, left: -28, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.2)" />
                <XAxis
                  dataKey="label"
                  ticks={ticks}
                  tick={{ fontSize: 7, fill: 'hsl(var(--muted-foreground)/0.6)' }}
                  tickLine={false} axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 7, fill: 'hsl(var(--muted-foreground)/0.6)' }}
                  tickLine={false} axisLine={false}
                  allowDecimals={false} width={26}
                />
                <Tooltip content={<ChartTooltip />} />
                {peakTotal > 0 && (
                  <ReferenceLine y={peakTotal} stroke="hsl(var(--muted-foreground)/0.15)" strokeDasharray="4 3"
                    label={{ value: `pk ${peakTotal}`, position: 'insideTopRight', fontSize: 6, fill: 'hsl(var(--muted-foreground)/0.4)' }} />
                )}
                <Line type="monotone" dataKey="total_calls"     stroke="#f59e0b" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
                <Line type="monotone" dataKey="connected_calls" stroke="#14b8a6" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
                {showConcurrent && peakConc > 0 && (
                  <Line type="monotone" dataKey="concurrent_calls" stroke="#818cf8" strokeWidth={1} strokeDasharray="4 3" dot={false} activeDot={{ r: 2 }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 px-0.5">
        <span className="flex items-center gap-1 text-[8px] text-muted-foreground/50"><span className="w-3.5 h-px bg-amber-400 inline-block" />total</span>
        <span className="flex items-center gap-1 text-[8px] text-muted-foreground/50"><span className="w-3.5 h-px bg-teal-400 inline-block" />connected</span>
        {showConcurrent && <span className="flex items-center gap-1 text-[8px] text-muted-foreground/50"><span className="w-3.5 h-px bg-indigo-400 inline-block border-dashed border-b border-indigo-400" />live</span>}
      </div>
    </div>
  );
}

// ── Stats table ───────────────────────────────────────────────────────────────
function StatVal({ v }: { v: number }) {
  return (
    <td className="px-2 py-0.5 text-right text-[11px] tabular-nums">
      {v === 0 ? <span className="text-muted-foreground/25">-</span> : <span className="text-foreground/80">{v}</span>}
    </td>
  );
}
function StatsTable({ entity }: { entity: EntityData }) {
  return (
    <table className="w-full text-xs border-t border-border/25">
      <thead>
        <tr>
          <th className="px-2 py-1 text-left text-[9px] font-normal text-muted-foreground/40 w-28" />
          {(['Cur','Min','Max','Avg'] as const).map(h => (
            <th key={h} className="px-2 py-1 text-right text-[9px] font-semibold text-muted-foreground/50">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-border/10">
          <td className="px-2 py-0.5 text-[10px] font-medium text-amber-400/80">Total_Calls</td>
          <StatVal v={entity.stats.total.cur} /><StatVal v={entity.stats.total.min} />
          <StatVal v={entity.stats.total.max} /><StatVal v={entity.stats.total.avg} />
        </tr>
        <tr className="border-t border-border/10">
          <td className="px-2 py-0.5 text-[10px] font-medium text-teal-400/80">Connected_Calls</td>
          <StatVal v={entity.stats.connected.cur} /><StatVal v={entity.stats.connected.min} />
          <StatVal v={entity.stats.connected.max} /><StatVal v={entity.stats.connected.avg} />
        </tr>
      </tbody>
      <tfoot>
        <tr className="border-t border-border/20">
          <td colSpan={3} className="px-2 pt-1 pb-0.5 text-[9px] text-muted-foreground/35">Last Updated</td>
          <td className="px-2 pt-1 pb-0.5 text-right text-[9px] tabular-nums text-muted-foreground/35">{entity.lastUpdatedAt}</td>
          <td className="px-2 pt-1 pb-0.5 text-right text-[9px] tabular-nums text-muted-foreground/35">{entity.lastUpdatedDate}</td>
        </tr>
      </tfoot>
    </table>
  );
}

// ── KAM client pills ──────────────────────────────────────────────────────────
function KamClientList({ clients }: { clients: string[] }) {
  return (
    <div className="px-3 py-1.5 border-t border-border/20 flex flex-wrap gap-1 items-center">
      {clients.slice(0, 6).map(c => (
        <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/30 border border-border/30 text-muted-foreground/60">{c}</span>
      ))}
      {clients.length > 6 && (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/30 border border-border/30 text-muted-foreground/40">+{clients.length - 6} more</span>
      )}
    </div>
  );
}

// ── Entity card ───────────────────────────────────────────────────────────────
function EntityCard({ entity, cardRef }: { entity: EntityData; cardRef?: (el: HTMLDivElement | null) => void }) {
  const live    = entity.curConcurrent > 0;
  const hasData = entity.todayCalls > 0;
  const hasConcurrent = entity.daily.some(d => d.concurrent_calls > 0);

  return (
    <div
      ref={cardRef}
      id={`entity-${entity.name.replace(/\W+/g, '-')}`}
      data-testid={`card-entity-${entity.name}`}
      className={cn("bg-card border rounded-xl overflow-hidden transition-all hover:shadow-lg hover:shadow-black/20", cardBorder(entity))}
    >
      {/* Header */}
      <div className={cn("flex items-center gap-2 px-4 py-2.5 border-b border-border/30", live ? "bg-gradient-to-r from-blue-500/5 to-transparent" : "bg-muted/8")}>
        <div className="flex-shrink-0">
          {live
            ? <span className="flex items-center gap-1 text-[10px] font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />{entity.curConcurrent}
              </span>
            : <WifiOff className="w-3.5 h-3.5 text-muted-foreground/20" />
          }
        </div>
        <h3 className="text-sm font-semibold flex-1 truncate" title={entity.name}>{entity.name}</h3>
        {hasData && (
          <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border flex-shrink-0", trendBg(entity.trendPct))}>
            <TrendIcon pct={entity.trendPct} />
            {entity.trendPct > 0 ? '+' : ''}{entity.trendPct}%
          </span>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 border-b border-border/20 divide-x divide-border/15">
        {[
          { label: 'Today',      value: entity.todayCalls > 0 ? entity.todayCalls : '-', sub: 'calls',       cls: hasData ? 'text-foreground' : 'text-muted-foreground/30' },
          { label: 'ASR',        value: entity.asr > 0 ? `${entity.asr}%` : '-',         sub: 'answer rate', cls: asrColor(entity.asr) },
          { label: 'ACD',        value: fmtAcd(entity.acdSecs),                           sub: 'avg duration',cls: 'text-foreground' },
          { label: 'Peak/24h',   value: entity.stats.total.max || '-',                    sub: 'hourly max',  cls: 'text-foreground' },
        ].map(item => (
          <div key={item.label} className="flex flex-col items-center py-2 gap-0.5">
            <span className="text-[8px] text-muted-foreground/45 uppercase tracking-wider">{item.label}</span>
            <span className={cn("text-sm font-bold tabular-nums", item.cls)}>{item.value}</span>
            <span className="text-[8px] text-muted-foreground/35">{item.sub}</span>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="p-3 grid grid-cols-2 gap-3 min-w-0">
        <div className="min-w-0 overflow-hidden">
          <MiniChart data={entity.daily}  span="Daily"  asr={entity.asr}      showConcurrent={hasConcurrent} />
        </div>
        <div className="min-w-0 overflow-hidden">
          <MiniChart data={entity.weekly} span="Weekly" asr={entity.weeklyAsr} showConcurrent={false} />
        </div>
      </div>

      {/* Stats */}
      <div className="px-1 pb-1"><StatsTable entity={entity} /></div>

      {/* KAM clients */}
      {entity.clients && entity.clients.length > 0 && <KamClientList clients={entity.clients} />}
    </div>
  );
}

// ── Summary strip ─────────────────────────────────────────────────────────────
function SummaryStrip({ summary, count, label }: { summary: Summary; count: number; label: string }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 border-b border-border/40 bg-card/30 divide-x divide-border/25">
      {[
        { title: 'Active Entities',  value: count,                      cls: 'text-blue-400',    fmt: String },
        { title: 'Live Calls',       value: summary.totalConcurrent,    cls: 'text-emerald-400', fmt: (v: number) => v > 0 ? String(v) : '-' },
        { title: "Today's Calls",    value: summary.totalToday,         cls: 'text-amber-400',   fmt: String },
        { title: 'Overall ASR',      value: summary.overallAsr,         cls: asrColor(summary.overallAsr), fmt: (v: number) => v > 0 ? `${v}%` : '-' },
        { title: 'Overall ACD',      value: summary.overallAcdSecs,     cls: 'text-violet-400',  fmt: fmtAcd },
      ].map((item, i) => (
        <div key={i} className="flex flex-col px-5 py-2.5">
          <span className="text-[9px] text-muted-foreground/45 uppercase tracking-wider">{item.title}</span>
          <span className={cn("text-lg font-bold tabular-nums", item.cls)}>{item.fmt(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BitsEyePage() {
  // Read params from URL (set by sidebar links)
  const search   = useSearch();
  const [, setLocation] = useLocation();
  const params   = new URLSearchParams(search);
  const view     = (params.get('view') || 'clients') as 'clients' | 'vendors' | 'kam';
  const kamIdStr = params.get('kamId');
  const kamId    = kamIdStr ? Number(kamIdStr) : undefined;

  // Map view → API category
  const category = view === 'kam' ? 'kam' : view;

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Viewer filtering: only show their assigned clients/KAM
  const { role } = useAuth();
  const isViewer = role === 'viewer';
  const { data: viewerAccounts } = useQuery<{ kamId: number | null; kamName: string | null; accountIds: string[]; clientNames: string[] }>({
    queryKey: ['/api/user/assigned-accounts'],
    enabled: isViewer,
    staleTime: 60_000,
  });

  // For viewers: auto-redirect to their KAM view when navigating to /bitseye without a kamId
  const viewerKamId = viewerAccounts?.kamId;
  useEffect(() => {
    if (isViewer && viewerKamId && !kamIdStr && view !== 'kam') {
      setLocation(`/bitseye?view=kam&kamId=${viewerKamId}`);
    }
  }, [isViewer, viewerKamId, kamIdStr, view, setLocation]);

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery<PerEntityResponse>({
    queryKey: ['/api/bitseye/per-entity', category, kamId],
    queryFn: async () => {
      const p = new URLSearchParams({ category, aliveOnly: 'false' });
      // Viewers always query their own KAM id if on the clients view without a kamId
      if (kamId) p.set('kamId', String(kamId));
      else if (isViewer && viewerKamId && category === 'clients') p.set('kamId', String(viewerKamId));
      const r = await fetch(`/api/bitseye/per-entity?${p}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const allEntities = data?.entities ?? [];
  // Additional client-side filter: if viewer has assigned client names, restrict to those
  const viewerClientNames = new Set((viewerAccounts?.clientNames ?? []).map(n => n.toLowerCase()));
  const entities = isViewer && viewerClientNames.size > 0 && (view === 'clients' || view === 'kam')
    ? allEntities.filter(e => viewerClientNames.has(e.name.toLowerCase()))
    : allEntities;

  const summary  = data?.summary ?? { totalConcurrent: 0, totalToday: 0, overallAsr: 0, overallAcdSecs: 0 };

  const scrollToEntity = useCallback((name: string) => {
    const el = cardRefs.current[name];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Page title based on view
  const pageTitle = view === 'clients' ? 'Clients'
    : view === 'vendors' ? 'Vendors'
    : kamId ? 'KAM — Filtered' : 'KAM Overview';

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-border/50 bg-card/80 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="bg-amber-500/15 border border-amber-500/20 p-1.5 rounded-lg">
              <BarChart3 className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <span className="text-sm font-bold">BitsEye</span>
              <span className="ml-2 text-xs text-muted-foreground/50 font-medium">{pageTitle}</span>
            </div>
          </div>
          <div className="flex-1" />
          {isViewer && viewerAccounts?.kamName && (
            <span className="hidden md:flex items-center gap-1 text-[10px] text-blue-400/70 bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-lg">
              <Shield className="w-3 h-3" />
              {viewerAccounts.kamName}
            </span>
          )}
          {dataUpdatedAt > 0 && (
            <span className="hidden md:block text-[10px] text-muted-foreground/40 tabular-nums">
              {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            data-testid="btn-refresh"
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/60 transition-colors text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Summary strip ───────────────────────────────────────────── */}
      {!isLoading && entities.length > 0 && (
        <SummaryStrip summary={summary} count={entities.length} label={pageTitle} />
      )}

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left index panel */}
        <aside className="hidden xl:flex flex-col w-44 flex-shrink-0 border-r border-border/25 bg-card/15 overflow-y-auto">
          <div className="px-3 py-2 border-b border-border/20 sticky top-0 bg-card/80 backdrop-blur z-10">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">
              {pageTitle} ({entities.length})
            </p>
          </div>
          {isLoading ? (
            <div className="p-2 space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-6 rounded bg-muted/15 animate-pulse" />
              ))}
            </div>
          ) : (
            <nav className="p-1.5 space-y-px">
              {entities.map(e => (
                <button
                  key={e.name}
                  data-testid={`link-entity-${e.name}`}
                  onClick={() => scrollToEntity(e.name)}
                  title={e.name}
                  className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-left hover:bg-muted/35 transition-colors group"
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0",
                    e.curConcurrent > 0 ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/15")} />
                  <span className="flex-1 truncate text-[10px] text-muted-foreground group-hover:text-foreground">{e.name}</span>
                  <span className={cn("text-[9px] font-mono flex-shrink-0", trendColor(e.trendPct))}>
                    {e.trendPct > 0 ? '↑' : e.trendPct < 0 ? '↓' : '→'}
                  </span>
                  <ChevronRight className="w-2.5 h-2.5 opacity-0 group-hover:opacity-30 flex-shrink-0" />
                </button>
              ))}
            </nav>
          )}
        </aside>

        {/* Card grid */}
        <main className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-80 rounded-xl bg-muted/15 animate-pulse border border-border/25" />
              ))}
            </div>
          ) : entities.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
              <AlertCircle className="w-12 h-12 text-muted-foreground/15" />
              <div>
                <p className="text-base font-semibold text-muted-foreground/50">No data found</p>
                <p className="text-sm text-muted-foreground/30 mt-1">
                  No CDR or live-call data for {pageTitle}.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {entities.map(entity => (
                <EntityCard
                  key={entity.name}
                  entity={entity}
                  cardRef={el => { cardRefs.current[entity.name] = el; }}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
