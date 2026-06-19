
import { useQuery } from "@tanstack/react-query";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { GripVertical, PhoneCall, BarChart2, Activity, DollarSign, ShieldAlert, Radio, Wifi, WifiOff, Zap } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, Tooltip, AreaChart, Area } from "recharts";

// ── Shared widget shell ──────────────────────────────────────────────────────
export function SortableWidgetShell({ id, children, isDragging }: { id: string; children: React.ReactNode; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: dndDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("relative group", (isDragging || dndDragging) && "opacity-60 scale-95")}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2 left-2 z-20 cursor-grab active:cursor-grabbing p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted/60 transition-opacity touch-none"
        data-testid={`drag-handle-${id}`}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      {children}
    </div>
  );
}

// ── Helper card wrapper ──────────────────────────────────────────────────────
function KpiCard({ children, borderClass = "border-border/50", className }: { children: React.ReactNode; borderClass?: string; className?: string }) {
  return (
    <div className={cn("bg-card rounded-xl border p-4 shadow-sm relative overflow-hidden group/card transition-all duration-300 hover:shadow-md pl-8", borderClass, className)}>
      {children}
    </div>
  );
}

function KpiLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground font-medium leading-tight">{children}</p>;
}

function KpiValue({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-2xl font-bold tracking-tight tabular-nums mt-0.5", className)}>{children}</p>;
}

function KpiSub({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-tight">{children}</p>;
}

// ── 1. Host Status ────────────────────────────────────────────────────────────
export function HostStatusWidget() {
  const { data } = useQuery<{ active: boolean; username?: string; connectedAt?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 120_000,
  });
  const { data: lc } = useQuery<{ calls: any[]; connected?: boolean }>({
    queryKey: ['/api/sippy/live-calls'],
    staleTime: 90_000,
  });
  const connected = data?.active === true || lc?.connected === true;
  return (
    <KpiCard borderClass={connected ? "border-emerald-500/30" : "border-rose-500/20"}>
      <div className="flex items-center justify-between mb-2">
        <KpiLabel>Host Status</KpiLabel>
        {connected
          ? <Wifi className="h-3.5 w-3.5 text-emerald-400" />
          : <WifiOff className="h-3.5 w-3.5 text-rose-400" />
        }
      </div>
      <KpiValue className={connected ? "text-emerald-400" : "text-rose-400"}>
        {connected ? "Online" : "Offline"}
      </KpiValue>
      <KpiSub>
        {connected ? `Connected · ${data?.username ?? 'Sippy'}` : "Sippy not reachable"}
      </KpiSub>
      {connected && (
        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      )}
    </KpiCard>
  );
}

// ── 2. Live Calls Count ───────────────────────────────────────────────────────
export function LiveCallsWidget() {
  const { data } = useQuery<{ calls: any[]; connected?: boolean }>({
    queryKey: ['/api/sippy/live-calls'],
    staleTime: 90_000,
  });
  const count = data?.calls?.length ?? 0;
  return (
    <KpiCard borderClass="border-blue-500/20">
      <div className="flex items-center justify-between mb-2">
        <KpiLabel>Live Calls</KpiLabel>
        <PhoneCall className="h-3.5 w-3.5 text-blue-400" />
      </div>
      <KpiValue className="text-blue-400">{data ? count : '—'}</KpiValue>
      <KpiSub>{data?.connected ? "Active concurrent sessions" : "Connecting…"}</KpiSub>
    </KpiCard>
  );
}

// ── 3. ASR Card ───────────────────────────────────────────────────────────────
export function ASRWidget() {
  const { data } = useQuery<{ asr: number; connected: boolean }>({
    queryKey: ['/api/sippy/dashboard-stats'],
    refetchInterval: 60_000,
  });
  const asr = data?.asr ?? 0;
  const color = asr >= 15 ? "text-emerald-400" : asr >= 5 ? "text-amber-400" : "text-rose-400";
  const border = asr >= 15 ? "border-emerald-500/20" : asr >= 5 ? "border-amber-500/20" : "border-rose-500/20";
  return (
    <KpiCard borderClass={border}>
      <div className="flex items-center justify-between mb-2">
        <KpiLabel>ASR</KpiLabel>
        <BarChart2 className="h-3.5 w-3.5 text-emerald-400" />
      </div>
      <KpiValue className={data ? color : "text-muted-foreground/40"}>
        {data ? `${asr.toFixed(1)}%` : '—'}
      </KpiValue>
      <KpiSub>Answer-Seizure Ratio</KpiSub>
    </KpiCard>
  );
}

// ── 4. Balance Ticker ─────────────────────────────────────────────────────────
export function BalanceTickerWidget() {
  const { data } = useQuery<{ vendors: Array<{ iVendor: number; name: string; balance: number }>; ts: string | null }>({
    queryKey: ['/api/vendors/current-balances'],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });
  const vendors = data?.vendors ?? [];
  return (
    <KpiCard borderClass="border-violet-500/20">
      <div className="flex items-center justify-between mb-2">
        <KpiLabel>Vendor Balances</KpiLabel>
        <DollarSign className="h-3.5 w-3.5 text-violet-400" />
      </div>
      {vendors.length === 0 ? (
        <KpiValue className="text-muted-foreground/40">—</KpiValue>
      ) : vendors.length === 1 ? (
        <>
          <KpiValue className="text-violet-400">${vendors[0].balance.toFixed(2)}</KpiValue>
          <KpiSub>{vendors[0].name}</KpiSub>
        </>
      ) : (
        <div className="space-y-0.5 mt-1">
          {vendors.slice(0, 3).map(v => (
            <div key={v.iVendor} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground/70 truncate max-w-[100px]">{v.name}</span>
              <span className={cn("font-bold tabular-nums", v.balance < 0 ? "text-rose-400" : "text-violet-400")}>
                ${v.balance.toFixed(2)}
              </span>
            </div>
          ))}
          {vendors.length > 3 && (
            <p className="text-[10px] text-muted-foreground/50">+{vendors.length - 3} more</p>
          )}
        </div>
      )}
    </KpiCard>
  );
}

// ── 5. MOS Trend ─────────────────────────────────────────────────────────────
export function MOSTrendWidget() {
  const { data: stats } = useQuery<{ estimatedMos: number | null; acd: number; connected: boolean }>({
    queryKey: ['/api/sippy/dashboard-stats'],
    refetchInterval: 60_000,
  });
  const { data: trend } = useQuery<{ ok: boolean; points: Array<{ ts: number; mos?: number; acd?: number }> }>({
    queryKey: ['/api/sippy/monitoring/acd-asr'],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });

  const mos = stats?.estimatedMos ?? null;
  const color = mos == null ? "text-muted-foreground/40" : mos >= 4.0 ? "text-emerald-400" : mos >= 3.5 ? "text-amber-400" : "text-rose-400";
  const sparkData = (trend?.points ?? []).slice(-24).map(p => ({ v: p.acd ?? 0 }));

  return (
    <KpiCard borderClass={mos != null && mos >= 4 ? "border-emerald-500/20" : "border-amber-500/20"}>
      <div className="flex items-center justify-between mb-2">
        <KpiLabel>MOS</KpiLabel>
        <Activity className="h-3.5 w-3.5 text-emerald-400" />
      </div>
      <KpiValue className={color}>{mos != null ? mos.toFixed(2) : '—'}</KpiValue>
      <KpiSub>E-model Mean Opinion Score</KpiSub>
      {sparkData.length > 3 && (
        <div className="mt-2 h-8">
          <ResponsiveContainer width="100%" height={32}>
            <AreaChart data={sparkData}>
              <Area type="monotone" dataKey="v" stroke="#10b981" strokeWidth={1.5} fill="#10b98115" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </KpiCard>
  );
}

// ── 6. Fraud / FAS Count ─────────────────────────────────────────────────────
export function FraudCountWidget() {
  const { data } = useQuery<{ events: Array<{ id: number; fraudScore?: number; detectedAt: string }> }>({
    queryKey: ['/api/fas-events'],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });
  const count = data?.events?.length ?? 0;
  const highScore = data?.events?.filter(e => (e.fraudScore ?? 0) >= 70).length ?? 0;
  const color = count === 0 ? "text-emerald-400" : count < 5 ? "text-amber-400" : "text-rose-400";
  const border = count === 0 ? "border-emerald-500/15" : count < 5 ? "border-amber-500/20" : "border-rose-500/25";
  return (
    <KpiCard borderClass={border}>
      <div className="flex items-center justify-between mb-2">
        <KpiLabel>Fraud / FAS</KpiLabel>
        <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
      </div>
      <KpiValue className={data ? color : "text-muted-foreground/40"}>
        {data ? count : '—'}
      </KpiValue>
      <KpiSub>
        {data
          ? count === 0 ? "No FAS events detected" : `${highScore} high-risk · last 100 CDRs`
          : "Loading…"
        }
      </KpiSub>
    </KpiCard>
  );
}

// ── 7. BitsEye Traffic Graph ──────────────────────────────────────────────────
export function BitsEyeGraphWidget() {
  const { data } = useQuery<{ ok: boolean; points: Array<{ ts: number; calls_in_progress?: number; [k: string]: any }> }>({
    queryKey: ['/api/sippy/monitoring/graph', 'widget'],
    queryFn: () => fetch('/api/sippy/monitoring/graph?type=calls_in_progress_total&hours=6').then(r => r.json()),
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });

  const points = (data?.points ?? []).slice(-30).map(p => {
    const val = p.calls_in_progress ?? Object.values(p).find(v => typeof v === 'number' && v !== p.ts) ?? 0;
    return { v: typeof val === 'number' ? val : 0 };
  });
  const maxV = Math.max(...points.map(p => p.v), 1);

  return (
    <KpiCard borderClass="border-cyan-500/20">
      <div className="flex items-center justify-between mb-2">
        <KpiLabel>Traffic Graph</KpiLabel>
        <Radio className="h-3.5 w-3.5 text-cyan-400" />
      </div>
      {points.length > 3 ? (
        <>
          <KpiValue className="text-cyan-400">{points[points.length - 1]?.v ?? 0}</KpiValue>
          <KpiSub>Calls in progress · last 6h</KpiSub>
          <div className="mt-2 h-10">
            <ResponsiveContainer width="100%" height={40}>
              <AreaChart data={points}>
                <Area type="monotone" dataKey="v" stroke="#06b6d4" strokeWidth={1.5} fill="#06b6d415" dot={false} />
                <Tooltip content={() => null} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <>
          <KpiValue className="text-muted-foreground/40">—</KpiValue>
          <KpiSub>No monitoring data yet</KpiSub>
        </>
      )}
    </KpiCard>
  );
}

// ── Widget renderer ───────────────────────────────────────────────────────────
const WIDGET_MAP: Record<string, React.ComponentType> = {
  host_status:     HostStatusWidget,
  live_calls_count: LiveCallsWidget,
  asr_card:        ASRWidget,
  balance_ticker:  BalanceTickerWidget,
  mos_trend:       MOSTrendWidget,
  fraud_count:     FraudCountWidget,
  bitseye_graph:   BitsEyeGraphWidget,
};

export function KpiWidgetRenderer({ id }: { id: string }) {
  const Comp = WIDGET_MAP[id];
  if (!Comp) return null;
  return <Comp />;
}

// ── Widget metadata (used in drawer library) ─────────────────────────────────
export const KPI_WIDGET_DEFS = [
  { id: 'host_status',     label: 'Host Status',      description: 'Sippy softswitch connectivity status', icon: Wifi },
  { id: 'live_calls_count',label: 'Live Calls',        description: 'Current active concurrent calls', icon: PhoneCall },
  { id: 'asr_card',        label: 'ASR',               description: 'Answer-Seizure Ratio %', icon: BarChart2 },
  { id: 'balance_ticker',  label: 'Vendor Balances',   description: 'Live vendor account balances', icon: DollarSign },
  { id: 'mos_trend',       label: 'MOS Trend',         description: 'Mean Opinion Score + trend sparkline', icon: Activity },
  { id: 'fraud_count',     label: 'Fraud / FAS',       description: 'False Answer Supervision detection count', icon: ShieldAlert },
  { id: 'bitseye_graph',   label: 'Traffic Graph',     description: 'Calls-in-progress mini BitsEye chart', icon: Radio },
] as const;

export type KpiWidgetId = typeof KPI_WIDGET_DEFS[number]['id'];
export const DEFAULT_KPI_ORDER: KpiWidgetId[] = ['host_status', 'live_calls_count', 'asr_card', 'balance_ticker', 'mos_trend', 'fraud_count', 'bitseye_graph'];
