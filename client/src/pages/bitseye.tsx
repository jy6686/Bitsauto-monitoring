import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  Building2, Truck, UserCheck, RefreshCw, ChevronRight,
  Activity, Wifi, WifiOff, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface EntityStats {
  cur: number; min: number; max: number; avg: number;
}
interface EntityData {
  name: string;
  daily:  { label: string; total_calls: number; connected_calls: number }[];
  weekly: { label: string; total_calls: number; connected_calls: number }[];
  curConcurrent: number;
  stats: { total: EntityStats; connected: EntityStats };
  lastUpdatedAt:   string;
  lastUpdatedDate: string;
}
interface PerEntityResponse {
  entities: EntityData[];
  totalEntities: number;
  updatedAt: string;
}

type Category = 'clients' | 'vendors' | 'kam';
type OrderBy  = 'traffic' | 'name';

const CATEGORY_TABS: { id: Category; label: string; icon: typeof Building2 }[] = [
  { id: 'clients', label: 'Clients',  icon: Building2 },
  { id: 'vendors', label: 'Vendors',  icon: Truck      },
  { id: 'kam',     label: 'KAM',      icon: UserCheck  },
];

// ── Mini stat cell ────────────────────────────────────────────────────────────
function StatCell({ value }: { value: number }) {
  return (
    <td className="px-3 py-1 text-right text-xs tabular-nums text-foreground/80">
      {value === 0 ? <span className="text-muted-foreground/40">-</span> : value}
    </td>
  );
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }} className="font-semibold">
            {p.dataKey === 'total_calls' ? 'Total' : 'Connected'}:
          </span>
          <span className="text-foreground font-mono">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Mini chart (Daily or Weekly) ──────────────────────────────────────────────
function MiniChart({
  data, span, height = 110,
}: {
  data: { label: string; total_calls: number; connected_calls: number }[];
  span: 'Daily' | 'Weekly';
  height?: number;
}) {
  const hasData = data.some(d => d.total_calls > 0 || d.connected_calls > 0);
  const ticks = span === 'Daily'
    ? data.filter((_, i) => i % 6 === 0).map(d => d.label)
    : data.map(d => d.label);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-semibold text-center text-muted-foreground tracking-widest uppercase">{span}</p>
      {!hasData ? (
        <div style={{ height }} className="flex items-center justify-center text-muted-foreground/30 text-xs">
          No data
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
            <XAxis
              dataKey="label"
              ticks={ticks}
              tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={28}
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="total_calls"
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
              name="total_calls"
            />
            <Line
              type="monotone"
              dataKey="connected_calls"
              stroke="#14b8a6"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
              name="connected_calls"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="flex items-center justify-center gap-4 mt-0.5">
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="w-4 h-0.5 bg-amber-400 inline-block rounded" />total_calls
        </span>
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="w-4 h-0.5 bg-teal-400 inline-block rounded" />connected_calls
        </span>
      </div>
    </div>
  );
}

// ── Stats table ───────────────────────────────────────────────────────────────
function StatsTable({ entity }: { entity: EntityData }) {
  return (
    <div className="border-t border-border/30 mt-2 pt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/20">
            <th className="px-3 py-0.5 text-left font-normal text-muted-foreground/60 text-[10px]"></th>
            <th className="px-3 py-0.5 text-right font-semibold text-muted-foreground/80 text-[10px]">Cur</th>
            <th className="px-3 py-0.5 text-right font-semibold text-muted-foreground/80 text-[10px]">Min</th>
            <th className="px-3 py-0.5 text-right font-semibold text-muted-foreground/80 text-[10px]">Max</th>
            <th className="px-3 py-0.5 text-right font-semibold text-muted-foreground/80 text-[10px]">Avg</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/10">
            <td className="px-3 py-1 text-left text-[10px] text-amber-400/80 font-medium">Total_Calls</td>
            <StatCell value={entity.stats.total.cur} />
            <StatCell value={entity.stats.total.min} />
            <StatCell value={entity.stats.total.max} />
            <StatCell value={entity.stats.total.avg} />
          </tr>
          <tr>
            <td className="px-3 py-1 text-left text-[10px] text-teal-400/80 font-medium">Connected_Calls</td>
            <StatCell value={entity.stats.connected.cur} />
            <StatCell value={entity.stats.connected.min} />
            <StatCell value={entity.stats.connected.max} />
            <StatCell value={entity.stats.connected.avg} />
          </tr>
        </tbody>
        <tfoot>
          <tr className="border-t border-border/20">
            <td colSpan={3} className="px-3 pt-1 text-[9px] text-muted-foreground/40">
              Last Updated
            </td>
            <td className="px-3 pt-1 text-right text-[9px] text-muted-foreground/50 tabular-nums">
              {entity.lastUpdatedAt}
            </td>
            <td className="px-3 pt-1 text-right text-[9px] text-muted-foreground/50 tabular-nums">
              {entity.lastUpdatedDate}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Entity Card ───────────────────────────────────────────────────────────────
function EntityCard({ entity, cardRef }: { entity: EntityData; cardRef?: (el: HTMLDivElement | null) => void }) {
  const isAlive = entity.curConcurrent > 0;
  return (
    <div
      ref={cardRef}
      id={`entity-${entity.name.replace(/\s+/g, '-')}`}
      data-testid={`card-entity-${entity.name}`}
      className="bg-card border border-border/50 rounded-xl overflow-hidden hover:border-border transition-colors"
    >
      {/* Card header */}
      <div className={cn(
        "flex items-center gap-2 px-4 py-2.5 border-b border-border/40",
        isAlive ? "bg-emerald-500/5" : "bg-muted/20"
      )}>
        {isAlive
          ? <Wifi className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          : <WifiOff className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
        }
        <h3 className="text-sm font-semibold flex-1 truncate">{entity.name}</h3>
        {isAlive && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono tabular-nums flex-shrink-0">
            {entity.curConcurrent} live
          </span>
        )}
      </div>

      {/* Charts */}
      <div className="p-3 grid grid-cols-2 gap-3">
        <MiniChart data={entity.daily}  span="Daily"  />
        <MiniChart data={entity.weekly} span="Weekly" />
      </div>

      {/* Stats */}
      <div className="px-1 pb-2">
        <StatsTable entity={entity} />
      </div>
    </div>
  );
}

// ── Main BitsEye Page ─────────────────────────────────────────────────────────
export default function BitsEyePage() {
  const [category,  setCategory]  = useState<Category>('clients');
  const [aliveOnly, setAliveOnly] = useState(true);
  const [orderBy,   setOrderBy]   = useState<OrderBy>('traffic');

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery<PerEntityResponse>({
    queryKey: ['/api/bitseye/per-entity', category, aliveOnly, orderBy],
    queryFn: async () => {
      const params = new URLSearchParams({
        category,
        aliveOnly: String(aliveOnly),
        orderBy,
      });
      const r = await fetch(`/api/bitseye/per-entity?${params}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const entities = data?.entities ?? [];

  const scrollToEntity = useCallback((name: string) => {
    const el = cardRefs.current[name];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">

      {/* ── Top filter bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-border/50 bg-card/80 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">

          {/* Logo / title */}
          <div className="flex items-center gap-2 mr-2">
            <div className="bg-amber-500/15 p-1.5 rounded-lg">
              <BarChart3 className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight">BitsEye</span>
              <span className="ml-1.5 text-[10px] text-muted-foreground/50 font-mono">Live Graphs</span>
            </div>
          </div>

          <div className="h-5 w-px bg-border/40" />

          {/* Category tabs */}
          <div className="flex items-center gap-1 bg-muted/30 border border-border/40 rounded-lg p-0.5">
            {CATEGORY_TABS.map(tab => (
              <button
                key={tab.id}
                data-testid={`btn-category-${tab.id}`}
                onClick={() => setCategory(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  category === tab.id
                    ? "bg-card shadow-sm text-foreground border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Graph Type (static) */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/20 border border-border/30 rounded-lg text-xs text-muted-foreground">
            <Activity className="w-3.5 h-3.5" />
            <span>CALLS</span>
          </div>

          {/* Alive only toggle */}
          <button
            data-testid="btn-alive-only"
            onClick={() => setAliveOnly(o => !o)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
              aliveOnly
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                : "bg-muted/20 border-border/30 text-muted-foreground hover:text-foreground"
            )}
          >
            <Wifi className="w-3.5 h-3.5" />
            {aliveOnly ? "Active" : "All"}
          </button>

          {/* Order by */}
          <div className="flex items-center gap-1 bg-muted/30 border border-border/40 rounded-lg p-0.5">
            {(['traffic', 'name'] as OrderBy[]).map(o => (
              <button
                key={o}
                data-testid={`btn-order-${o}`}
                onClick={() => setOrderBy(o)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize",
                  orderBy === o
                    ? "bg-card shadow-sm text-foreground border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {o === 'traffic' ? 'By Traffic' : 'By Name'}
              </button>
            ))}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Stats & refresh */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {data && (
              <span data-testid="text-entity-count">
                <strong className="text-foreground">{entities.length}</strong> {category}
              </span>
            )}
            {dataUpdatedAt > 0 && (
              <span className="hidden sm:block tabular-nums">
                Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
              </span>
            )}
            <button
              data-testid="btn-refresh"
              onClick={() => refetch()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
              <span className="hidden sm:block">Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Body: left panel + card grid ──────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left entity index panel */}
        <aside className="hidden lg:flex flex-col w-52 flex-shrink-0 border-r border-border/40 bg-card/30 overflow-y-auto">
          <div className="px-4 py-3 border-b border-border/30">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {CATEGORY_TABS.find(t => t.id === category)?.label}
            </p>
          </div>
          {isLoading ? (
            <div className="flex flex-col gap-1 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-7 rounded bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : entities.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground/40 text-center">No entities</div>
          ) : (
            <nav className="flex flex-col p-2 gap-0.5">
              {entities.map(e => (
                <button
                  key={e.name}
                  data-testid={`link-entity-${e.name}`}
                  onClick={() => scrollToEntity(e.name)}
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors group"
                >
                  {e.curConcurrent > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse" />
                  )}
                  {e.curConcurrent === 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20 flex-shrink-0" />
                  )}
                  <span className="flex-1 truncate">{e.name}</span>
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-50 flex-shrink-0 transition-opacity" />
                </button>
              ))}
            </nav>
          )}
        </aside>

        {/* Main card grid */}
        <main className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-72 rounded-xl bg-muted/20 animate-pulse border border-border/30" />
              ))}
            </div>
          ) : entities.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground/40">
              <BarChart3 className="w-14 h-14 opacity-20" />
              <div className="text-center">
                <p className="text-lg font-semibold">No data available</p>
                <p className="text-sm mt-1">
                  {aliveOnly
                    ? `No active ${category} found. Try switching to "All" mode.`
                    : `No CDR or live-call data found for ${category}.`}
                </p>
              </div>
              {aliveOnly && (
                <button
                  onClick={() => setAliveOnly(false)}
                  className="px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm hover:bg-primary/20 transition-colors"
                >
                  Show All {CATEGORY_TABS.find(t => t.id === category)?.label}
                </button>
              )}
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
