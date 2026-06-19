import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNocWebSocket } from "@/hooks/use-noc-ws";
import { useDashboardStats } from "@/hooks/use-dashboard";
import { useCalls } from "@/hooks/use-calls";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/hooks/use-auth";
import { StatCard } from "@/components/stat-card";
import { MosBadge } from "@/components/mos-badge";
import { Link } from "wouter";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import {
  SortableWidgetShell,
  KpiWidgetRenderer,
  KPI_WIDGET_DEFS,
  DEFAULT_KPI_ORDER,
  type KpiWidgetId,
} from "@/components/kpi-widgets";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { MONITORING_ITEMS, MGMT_CONFIGURABLE_FEATURES } from "@shared/schema";
import { 
  Activity, 
  Server, 
  AlertTriangle, 
  PhoneCall, 
  ArrowRight,
  BarChart2,
  RefreshCw,
  Clock,
  Timer,
  PhoneMissed,
  PhoneOff,
  Signal,
  CheckCircle2,
  Globe,
  DollarSign,
  PhoneIncoming,
  Settings,
  ShieldAlert,
  Eye,
  TrendingUp,
  TrendingDown,
  Zap,
  Users,
  Award,
  Radio,
  ArrowUpRight,
  Minus,
  Target,
  SlidersHorizontal,
  Pencil,
  ChevronDown,
  ChevronUp,
  Plus,
  Check,
  LayoutGrid,
  Download,
  FileSpreadsheet,
  Info,
  ExternalLink,
  LayoutDashboard,
  Monitor,
  ScanSearch,
  ChevronRight,
} from "lucide-react";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { 
  ComposedChart,
  AreaChart,
  Area, 
  Bar,
  BarChart,
  Line,
  PieChart,
  Pie,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
} from "recharts";
import { BseTooltip, BSE_GRID_PROPS, BSE_AXIS_PROPS, BSE_CURSOR, BseGradStops, bseActiveDot } from "@/components/bse-chart";
import { formatUTC } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { lookupCountry } from "@/lib/country-lookup";
import { useTimezone, TZ_OPTIONS, getTzAbbr } from "@/context/timezone-context";
import { formatInTz } from "@/lib/date-utils";

// ── MiniSparkline — tiny SVG polyline from an array of values ────────────────
function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (!values || values.length < 2) return <div style={{ width: 52, height: 18 }} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const W = 52, H = 18;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={W} height={H} className="flex-shrink-0 opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── DashTopEntityCard — carrier-grade Top-3 entity card with sparklines ──────
function DashTopEntityCard({ title, icon, entities, dim, color, loading }: {
  title: string;
  icon: 'users' | 'radio' | 'globe';
  entities: Array<{ name: string; active: number; connected: number; connectRate: number }>;
  dim: string;
  color: 'violet' | 'blue' | 'emerald';
  loading?: boolean;
}) {
  const IconComp = icon === 'users' ? Users : icon === 'radio' ? Radio : Globe;
  const c = {
    violet:  { border: 'border-violet-500/25',  icon: 'text-violet-400',  badge: 'bg-violet-500/15 text-violet-300',  dot: 'bg-violet-400',  spark: '#8B5CF6' },
    blue:    { border: 'border-blue-500/25',    icon: 'text-blue-400',    badge: 'bg-blue-500/15 text-blue-300',    dot: 'bg-blue-400',    spark: '#3B82F6' },
    emerald: { border: 'border-emerald-500/25', icon: 'text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300', dot: 'bg-emerald-400', spark: '#10B981' },
  }[color];

  // Fetch sparklines for the top 3 entities — 3 fixed hooks (Rules of Hooks safe)
  const e0 = entities[0]?.name ?? '';
  const e1 = entities[1]?.name ?? '';
  const e2 = entities[2]?.name ?? '';
  const s0 = useQuery<{ points: Array<{ total: number }> }>({
    queryKey: ['/api/bitseye/entity-history', dim, e0, 'live', 'calls'],
    queryFn: () => fetch(`/api/bitseye/entity-history?dim=${dim}&entity=${encodeURIComponent(e0)}&span=live&type=calls`).then(r => r.json()),
    enabled: !!e0, staleTime: 60_000, refetchInterval: 45_000,
  });
  const s1 = useQuery<{ points: Array<{ total: number }> }>({
    queryKey: ['/api/bitseye/entity-history', dim, e1, 'live', 'calls'],
    queryFn: () => fetch(`/api/bitseye/entity-history?dim=${dim}&entity=${encodeURIComponent(e1)}&span=live&type=calls`).then(r => r.json()),
    enabled: !!e1, staleTime: 60_000, refetchInterval: 45_000,
  });
  const s2 = useQuery<{ points: Array<{ total: number }> }>({
    queryKey: ['/api/bitseye/entity-history', dim, e2, 'live', 'calls'],
    queryFn: () => fetch(`/api/bitseye/entity-history?dim=${dim}&entity=${encodeURIComponent(e2)}&span=live&type=calls`).then(r => r.json()),
    enabled: !!e2, staleTime: 60_000, refetchInterval: 45_000,
  });
  const sparklines = [
    (s0.data?.points ?? []).map(p => p.total),
    (s1.data?.points ?? []).map(p => p.total),
    (s2.data?.points ?? []).map(p => p.total),
  ];

  return (
    <div className={`bg-card ${c.border} border rounded-xl shadow-md flex-1 min-h-0 overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/40">
        <div className="flex items-center gap-1.5">
          <IconComp className={`w-3.5 h-3.5 ${c.icon}`} />
          <span className="text-xs font-semibold">{title}</span>
        </div>
        <Link href="/bitseye2" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
          More <ArrowRight className="w-2.5 h-2.5" />
        </Link>
      </div>
      {/* Rows */}
      <div className="px-3.5 py-2">
        {loading ? (
          <div className="space-y-2.5">
            {[0,1,2].map(i => <div key={i} className="h-[30px] rounded bg-muted/30 animate-pulse" />)}
          </div>
        ) : entities.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/50 text-center py-4">No active traffic</p>
        ) : (
          <div className="divide-y divide-border/30">
            {entities.slice(0, 3).map((e, i) => (
              <div key={e.name} className="flex items-center gap-2 py-2 min-w-0" data-testid={`top-entity-${color}-${i}`}>
                {/* Rank */}
                <span className="text-[10px] font-bold text-muted-foreground/35 w-3.5 text-right flex-shrink-0 tabular-nums">{i + 1}</span>
                {/* Live dot */}
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot} ${e.active > 0 ? 'animate-pulse' : 'opacity-20'}`} />
                {/* Name */}
                <span className="text-[11px] font-medium truncate flex-1 min-w-0" title={e.name}>{e.name}</span>
                {/* Sparkline */}
                <MiniSparkline values={sparklines[i]} color={c.spark} />
                {/* Call count */}
                <span className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded flex-shrink-0 ${c.badge}`}>{e.active}</span>
                {/* ASR / CR */}
                {e.connectRate > 0 ? (
                  <span className={`text-[10px] tabular-nums font-semibold flex-shrink-0 w-8 text-right ${e.connectRate >= 70 ? 'text-emerald-400' : e.connectRate >= 40 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {e.connectRate}%
                  </span>
                ) : <span className="w-8 flex-shrink-0" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Parses Sippy's non-standard timestamp "20260411T20:20:32.055" → ms since epoch
function parseSippyTime(setupTime: string): number | null {
  if (!setupTime) return null;
  // Handle: "20260424T140225.000", "20260424T14:02:25.000", "2026-04-24 14:02:25", "2026-04-24T14:02:25"
  let s = setupTime.trim();
  // Compact date: 20260424T... → 2026-04-24T...
  s = s.replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T');
  // Compact time without colons: T140225 → T14:02:25
  s = s.replace(/T(\d{2})(\d{2})(\d{2})/, 'T$1:$2:$3');
  // Space separator → T
  s = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, '$1T$2');
  const t = new Date(s).getTime();
  return isNaN(t) ? null : t;
}

function fmtDur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Row component so each live-call row has its own ticking duration state
function LiveCallRow({ call, index }: { call: any; index: number }) {
  const [elapsed, setElapsed] = useState<number>(() => {
    if (call.setupTime) {
      const start = parseSippyTime(call.setupTime);
      if (start !== null) return Math.max(0, Math.floor((Date.now() - start) / 1000));
    }
    return parseFloat(call.duration ?? 0);
  });

  useEffect(() => {
    const start = call.setupTime ? parseSippyTime(call.setupTime) : null;
    if (start !== null) {
      const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    } else {
      setElapsed(parseFloat(call.duration ?? 0));
      const id = setInterval(() => setElapsed(v => v + 1), 1000);
      return () => clearInterval(id);
    }
  }, [call.setupTime]);

  const isConnected = call.callStatus === 'connected';
  const durLabel = elapsed > 0 ? fmtDur(elapsed) : '0s';
  let answerType: { label: string; cls: string; title: string };
  if (!isConnected) {
    answerType = { label: 'Routing', cls: 'bg-amber-500/15 text-amber-400', title: 'Call is being routed — not yet answered' };
  } else if (elapsed < 3) {
    answerType = { label: 'FAS Risk', cls: 'bg-red-500/15 text-red-400', title: `Connected in ${durLabel} — possible False Answer Supervision` };
  } else {
    answerType = { label: 'Real Answer', cls: 'bg-emerald-500/15 text-emerald-400', title: `Answered after ${durLabel} — genuine human answer` };
  }

  return (
    <tr key={index} className="hover:bg-muted/30 transition-colors" data-testid={`row-live-call-${index}`}>
      <td className="px-6 py-3 font-mono text-xs">{call.caller || '—'}</td>
      <td className="px-6 py-3 font-mono text-xs">{call.callee || '—'}</td>
      <td className="px-6 py-3 text-xs text-violet-400">{call.clientName || call.accountId || '—'}</td>
      <td className="px-6 py-3 text-xs">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
          isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
        }`}>{call.ccState || call.status || '—'}</span>
      </td>
      <td className={`px-6 py-3 text-xs font-mono ${isConnected && elapsed < 3 ? 'text-red-400 font-semibold' : 'text-muted-foreground'}`}>
        {durLabel}
      </td>
      <td className="px-6 py-3 text-xs">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${answerType.cls}`} title={answerType.title}>
          {answerType.label}
        </span>
      </td>
      <td className="px-6 py-3 text-xs text-muted-foreground">
        {call.setupTime ? call.setupTime.replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3 ').replace(/\.\d+$/, '') : '—'}
      </td>
    </tr>
  );
}

// ── Animated counter — smoothly transitions to new number ─────────────────────
function AnimatedCount({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const prev = prevRef.current;
    if (prev === value) return;
    prevRef.current = value;
    const duration = 700;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(prev + (value - prev) * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <span className={className}>{display}</span>;
}

// ── Network Health Gauge — radial arc SVG, 0-100 ─────────────────────────────
function NetworkHealthGauge({ score }: { score: number }) {
  const R = 52, cx = 68, cy = 76;
  const startDeg = 135, totalSweep = 270;
  const safePct = Math.min(0.999, Math.max(0, score / 100));
  const toXY = (deg: number) => ({
    x: cx + R * Math.cos((deg * Math.PI) / 180),
    y: cy + R * Math.sin((deg * Math.PI) / 180),
  });
  const s = toXY(startDeg);
  const trackEnd = toXY(startDeg + totalSweep);
  const fillEnd  = toXY(startDeg + safePct * totalSweep);
  const fillSweep = safePct * totalSweep;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <svg width="136" height="116" viewBox="0 0 136 116" className="overflow-visible">
      <path d={`M ${s.x} ${s.y} A ${R} ${R} 0 1 1 ${trackEnd.x} ${trackEnd.y}`}
        fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" strokeLinecap="round" />
      {score > 0 && (
        <path d={`M ${s.x} ${s.y} A ${R} ${R} 0 ${fillSweep > 180 ? 1 : 0} 1 ${fillEnd.x} ${fillEnd.y}`}
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${color}80)` }} />
      )}
      <text x={cx} y={cy - 4} textAnchor="middle" fill={score > 0 ? color : 'rgba(255,255,255,0.2)'}
        style={{ fontSize: '30px', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
        {score}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="rgba(255,255,255,0.25)"
        style={{ fontSize: '11px' }}>
        / 100
      </text>
    </svg>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, role, isAdmin } = useAuth();
  const { data: stats } = useDashboardStats();
  const { data: recentCalls } = useCalls(5);
  const { data: settings } = useSettings();
  const [trendHours, setTrendHours] = useState(1);

  // ── App clock ────────────────────────────────────────────────────────────────
  const { tz, setTz, tzAbbr } = useTimezone();
  const [clockDisplay, setClockDisplay] = useState({ time: '', date: '', abbr: '' });
  const [tzPickerOpen, setTzPickerOpen] = useState(false);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const time = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const date = now.toLocaleDateString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' });
      const abbr = getTzAbbr(tz);
      setClockDisplay({ time, date, abbr });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tz]);

  // Viewer's own monitoring assignments — fetched for all, used only for viewer role
  const { data: myAssignmentsData } = useQuery<{ userId: string; items: string[] }>({
    queryKey: ['/api/user/monitoring-assignments'],
  });

  // Viewer's assigned Sippy accounts (via KAM email match)
  const { data: myAccountsData } = useQuery<{ kamId: number | null; kamName: string | null; accountIds: string[]; clientNames: string[] }>({
    queryKey: ['/api/user/assigned-accounts'],
  });

  // Revenue & Margin Analytics — 30-day P&L summary from call snapshots
  type AnalyticsSummary = { totalRevenue: number; totalCost: number; totalProfit: number; margin: number };
  type AnalyticsClient  = { name: string; calls: number; minutes: number; revenue: number; cost: number; profit: number; margin: number };
  const { data: analyticsData, refetch: refetchAnalytics, isRefetching: analyticsRefetching } = useQuery<{
    period: { days: number; since: string };
    summary: AnalyticsSummary;
    byClient: AnalyticsClient[];
    byVendor: any[];
  }>({
    queryKey: ['/api/analytics/revenue', 30],
    queryFn: () => fetch('/api/analytics/revenue?days=30').then(r => r.json()),
    refetchInterval: 10 * 60_000,
    staleTime: 9 * 60_000,
  });



  // Dashboard widget preferences
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [ckDrillStatus, setCkDrillStatus] = useState<string | null>(null);
  const [ckDrillHours, setCkDrillHours]   = useState<number>(2);
  const [ckDrillViewStatus, setCkDrillViewStatus] = useState<string | null>(null);

  const ckDrillQuery = useQuery<{ status: string; hours: number; total: number; records: any[] }>({
    queryKey: ['/api/sippy/ck-drilldown', ckDrillViewStatus ?? ckDrillStatus, ckDrillHours],
    queryFn: () => fetch(`/api/sippy/ck-drilldown?status=${ckDrillViewStatus ?? ckDrillStatus}&hours=${ckDrillHours}`).then(r => r.json()),
    enabled: !!ckDrillStatus,
    staleTime: 30_000,
  });
  const { data: widgetPrefs } = useQuery<{ hiddenWidgets: string[]; widgetOrder: string[] }>({
    queryKey: ['/api/user/dashboard-prefs'],
  });
  const hiddenWidgets = new Set(widgetPrefs?.hiddenWidgets ?? []);
  const showWidget = (id: string) => !hiddenWidgets.has(id);

  // Management role: fetch which features are enabled so we can gate sections
  const { data: mgmtPermsData } = useQuery<{ enabledFeatures: string[] }>({
    queryKey: ['/api/settings/mgmt-permissions'],
    enabled: role === 'management',
    staleTime: 60_000,
  });
  // null = still loading (show all); Set = loaded (filter by enabled)
  const mgmtEnabledSet: Set<string> | null = mgmtPermsData
    ? new Set(mgmtPermsData.enabledFeatures ?? [])
    : null;
  const mgmtHas = (featureKey: string) => {
    if (role !== 'management') return true;
    if (mgmtEnabledSet === null) return true; // loading — show all
    return mgmtEnabledSet.has(featureKey);
  };

  // Dashboard section visibility: combines user toggle prefs AND mgmt feature gate
  const WIDGET_FEATURE_MAP: Record<string, string> = {
    revenue_analytics: 'analytics',
    asr_trend:         'graphs',
    fas_events:        'fraud_fas',
  };
  const sectionVisible = (widgetId: string): boolean => {
    if (!showWidget(widgetId)) return false;
    const featureKey = WIDGET_FEATURE_MAP[widgetId];
    if (featureKey && !mgmtHas(featureKey)) return false;
    return true;
  };
  // For the Customize sheet: filter available dashboard section toggles for management
  const availableMgmtFeatureKeys = new Set(
    MGMT_CONFIGURABLE_FEATURES.map(f => f.key)
  );

  const savePrefsMutation = useMutation({
    mutationFn: ({ hidden, order }: { hidden: string[]; order: string[] }) =>
      apiRequest('PUT', '/api/user/dashboard-prefs', { hiddenWidgets: hidden, widgetOrder: order }),
    onMutate: async ({ hidden, order }) => {
      await qc.cancelQueries({ queryKey: ['/api/user/dashboard-prefs'] });
      const prev = qc.getQueryData<{ hiddenWidgets: string[]; widgetOrder: string[] }>(['/api/user/dashboard-prefs']);
      qc.setQueryData(['/api/user/dashboard-prefs'], { hiddenWidgets: hidden, widgetOrder: order });
      return { prev };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['/api/user/dashboard-prefs'], ctx.prev);
      toast({ title: 'Failed to save preferences', description: 'Please try again.', variant: 'destructive' });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['/api/user/dashboard-prefs'] }),
  });

  const currentOrder: KpiWidgetId[] = (widgetPrefs?.widgetOrder?.length
    ? widgetPrefs.widgetOrder
    : DEFAULT_KPI_ORDER) as KpiWidgetId[];

  const toggleWidget = (id: string) => {
    const hidden = widgetPrefs?.hiddenWidgets ?? [];
    const updated = hidden.includes(id) ? hidden.filter(w => w !== id) : [...hidden, id];
    savePrefsMutation.mutate({ hidden: updated, order: currentOrder });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = currentOrder.indexOf(active.id as KpiWidgetId);
    const newIdx = currentOrder.indexOf(over.id as KpiWidgetId);
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = arrayMove([...currentOrder], oldIdx, newIdx);
    savePrefsMutation.mutate({ hidden: widgetPrefs?.hiddenWidgets ?? [], order: newOrder });
  }, [currentOrder, widgetPrefs, savePrefsMutation]);

  const DASHBOARD_WIDGETS = [
    { id: 'live_metrics',       label: 'Live Metrics Cards',           description: 'Active Calls, MOS, ASR, ACD, Traffic Score, CPS' },
    { id: 'revenue_analytics',  label: 'Revenue & Margin Analytics',   description: '30-day P&L summary, per-client and per-vendor breakdown' },
    { id: 'live_calls_table',   label: 'Live Calls Table',             description: 'Real-time active call list with quality metrics' },
    { id: 'asr_trend',          label: 'ASR/ACD Trend & Call Back Ratio', description: 'Historical ASR/ACD charts and FAS deduction graph' },
    { id: 'fas_events',         label: 'FAS Events & Stats',           description: 'False Answer Supervision detection log and summary' },
    { id: 'weekly_volume',      label: '7-Day Call Volume',            description: 'Daily answered vs failed call bar chart for the last 7 days' },
    { id: 'top_clients',        label: 'Top Clients by Volume',        description: '30-day client call distribution donut chart' },
    { id: 'carrier_health',     label: 'Carrier Health',               description: '24h stability scores per carrier with progress bars' },
    { id: 'top_destinations',   label: 'Top Traffic Destinations',     description: 'Last 7 days call volume ranked by country / destination' },
  ] as const;

  const SECTION_CHIPS = [
    { id: 'live_metrics',      label: 'Live Metrics' },
    { id: 'live_calls_table',  label: 'Live Calls' },
    { id: 'asr_trend',         label: 'ASR / ACD' },
    { id: 'revenue_analytics', label: 'Revenue & P&L' },
    { id: 'fas_events',        label: 'FAS Events' },
    { id: 'weekly_volume',     label: '7-Day Volume' },
    { id: 'carrier_health',    label: 'Carrier Health' },
    { id: 'top_destinations',  label: 'Top Destinations' },
  ] as const;

  // NOC WebSocket — push tick arrives every ~60s when background poller refreshes.
  // All live-calls queries are refetched on tick instead of individual per-user polling.
  const { lastTick } = useNocWebSocket();

  // Sippy session
  const { data: sippySession } = useQuery<{ active: boolean; username?: string; connectedAt?: string; portalUrl?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 120_000,
  });
  // Sippy live calls — poll every 60 s; WS tick triggers an immediate refetch on top of that.
  const { data: sippyLiveCalls, refetch: refetchLiveCalls, dataUpdatedAt: liveCallsUpdatedAt } = useQuery<{ calls: any[]; connected?: boolean; stale?: boolean; lastUpdated?: number; error?: string }>({
    queryKey: ['/api/sippy/live-calls'],
    staleTime: 25_000,
    refetchInterval: 30_000,   // fallback polling — NOC tick is primary but WS can be unreliable in production
  });
  // WS tick also triggers an immediate refetch
  useEffect(() => { if (lastTick) refetchLiveCalls(); }, [lastTick]);
  // Sippy real-time dashboard stats — ASR, ACD, PDD, active calls direct from Sippy switch
  const { data: sippyStats, isLoading: sippyStatsLoading, dataUpdatedAt: statsUpdatedAt } = useQuery<{
    asr: number; acd: number;
    connected: boolean;
    monOk?: boolean;          // true when getMonitoringGraphData XML-RPC is available
    monError?: string;        // error string from monitoring graph API if monOk=false
    credsMissing?: boolean;   // true only when api_admin_password is genuinely absent
    // CK stats from CDRs
    ckRatio?: number;
    ckBreakdown?: { connected: number; wrongNumber: number; switchedOff: number; untraceable: number; total: number };
    cdrCount?: number;
    // MOS estimate from E-model
    estimatedMos?: number | null;
    // CPS — from monitoring graph or CDR fallback
    cps?: number;
    cpsSource?: 'monitoring' | 'cdr';
    // Estimated NER
    ner?: number | null;
    nerBreakdown?: { answered: number; rna: number; subscriberSide: number; total: number };
  }>({
    queryKey: ['/api/sippy/dashboard-stats'],
    refetchInterval: 60_000,
  });
  const isSippyReachable = sippyLiveCalls?.connected === true || !!sippySession?.active || sippyStats?.connected === true;
  // Sippy ASR/ACD report — CDR-based revenue & margin stats for last 90 min
  const { data: sippyFinancials, refetch: refetchFinancials, isRefetching: financialsRefetching } = useQuery<{
    ok: boolean; period: string; costSource?: string;
    origination: { totalCalls: number; billableCalls: number; totalDurationSec: number; acd: number; asr: number; avgPdd: number; revenue: number };
    termination: { totalCalls: number; billableCalls: number; totalDurationSec: number; acd: number; asr: number; avgPdd: number; cost: number };
    margin: number;
  }>({
    queryKey: ['/api/sippy/asr-acd-stats'],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    enabled: isSippyReachable,
  });

  const { data: fasEventsData } = useQuery<{ events: any[] }>({
    queryKey: ['/api/fas-events'],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });

  const { data: weeklyVolumeData } = useQuery<{ hourly: any[]; topDestinations: any[]; topClients: any[] }>({
    queryKey: ['/api/sippy/cdr/graphs', 168],
    queryFn: () => fetch('/api/sippy/cdr/graphs?hours=168').then(r => r.json()),
    refetchInterval: 15 * 60_000,
    staleTime: 14 * 60_000,
    enabled: isSippyReachable,
  });

  const { data: carrierScoresRaw } = useQuery<any[]>({
    queryKey: ['/api/carrier-scores', 24],
    queryFn: () => fetch('/api/carrier-scores?window=24').then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 55_000,
    enabled: isSippyReachable,
  });
  const recentFasEvents = (fasEventsData?.events ?? []).slice(0, 5);
  const fasAll         = fasEventsData?.events ?? [];
  const fasZeroBilled  = fasAll.filter((e: any) => (e.reason ?? '').includes('zero_billed')).length;
  const fasHighPdd     = fasAll.filter((e: any) => (e.reason ?? '').includes('high_pdd')).length;
  const fasShortBilled = fasAll.filter((e: any) => (e.reason ?? '').includes('short_billed')).length;
  const fasEarlyAnswer = fasAll.filter((e: any) => (e.reason ?? '').includes('early_answer')).length;
  const fasBarData = [
    { name: 'Zero Billed',   count: fasZeroBilled,  fill: '#ef4444' },
    { name: 'High PDD',      count: fasHighPdd,     fill: '#f97316' },
    { name: 'Short Billed',  count: fasShortBilled, fill: '#a855f7' },
    { name: 'Early Answer',  count: fasEarlyAnswer, fill: '#eab308' },
  ];

  const { data: qualityTrend } = useQuery<{ ok: boolean; points: { ts: number; asr: number; acd: number }[] }>({
    queryKey: ['/api/sippy/monitoring/acd-asr', trendHours],
    queryFn: async () => {
      const res = await fetch(`/api/sippy/monitoring/acd-asr?hours=${trendHours}&interval=300`);
      if (!res.ok) throw new Error('Failed to fetch quality trend');
      return res.json();
    },
    refetchInterval: 60000,
    enabled: isSippyReachable,
  });

  // Active incidents — drives the System State card and incident strip
  const { data: activeIncidents } = useQuery<any[]>({
    queryKey: ['/api/incidents'],
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  // Active alerts count — for KPI card
  const { data: alertsListData } = useQuery<{ alerts: any[] } | any[]>({
    queryKey: ['/api/alerts'],
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
  const alertsCount = (() => {
    if (!alertsListData) return 0;
    if (Array.isArray(alertsListData)) return alertsListData.filter((a: any) => a.status !== 'resolved').length;
    const arr = (alertsListData as any).alerts ?? [];
    return arr.filter((a: any) => a.status !== 'resolved').length;
  })();

  // Pending approvals count — for KPI card
  const { data: pendingApprovalsCountData } = useQuery<{ count: number }>({
    queryKey: ['/api/approvals/pending-count'],
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
  const pendingCount = pendingApprovalsCountData?.count ?? 0;

  // Downsample monitoring points to ~30 for clean chart display
  const chartData = (() => {
    const pts = qualityTrend?.points ?? [];
    if (!pts.length) return [];
    const step = Math.max(1, Math.ceil(pts.length / 30));
    return pts
      .filter((_, i) => i % step === 0 || i === pts.length - 1)
      .map(p => ({
        time: formatUTC(new Date(p.ts * 1000), 'HH:mm'),
        asr: parseFloat(p.asr.toFixed(1)),
        acd: parseFloat(p.acd.toFixed(0)),
      }));
  })();


  const simulationOff = settings && !settings.simulationEnabled;
  // anyPortalActive: true as soon as any Sippy endpoint confirms reachability
  const anyPortalActive = isSippyReachable;
  const notConnected = simulationOff && !anyPortalActive;


  const liveCalls = sippyLiveCalls?.calls ?? [];

  // When Sippy is connected, use Sippy switch data for all KPI cards.
  // activeCalls + PDD come from /api/sippy/live-calls (5-second poll) — NOT dashboard-stats,
  // to avoid concurrent XML-RPC requests that throttle Sippy and break the Live Calls page.
  const displayActiveCalls = anyPortalActive ? liveCalls.length : (stats?.activeCalls ?? 0);
  const liveCallsStale = sippyLiveCalls?.stale === true;
  // Freshness: age of the data in seconds (use server lastUpdated if available, else client dataUpdatedAt)
  const liveCallsDataAgeMs = anyPortalActive
    ? (sippyLiveCalls?.lastUpdated ? Date.now() - sippyLiveCalls.lastUpdated : liveCallsUpdatedAt ? Date.now() - liveCallsUpdatedAt : null)
    : null;
  const liveCallsFreshness: 'fresh' | 'delay' | 'stale' | null =
    liveCallsDataAgeMs == null ? null
    : liveCallsDataAgeMs < 45_000 ? 'fresh'
    : liveCallsDataAgeMs < 90_000 ? 'delay'
    : 'stale';

  // Live connection-rate ASR: when CDR-based ASR is 0 but we have live calls,
  // estimate ASR from connected/(connected+routing) ratio as a proxy.
  const liveConnected = liveCalls.filter((c: any) => c.callStatus === 'connected').length;
  const liveTotal     = liveCalls.length;
  const liveAsrEstimate = liveTotal > 0 ? Math.round(liveConnected / liveTotal * 1000) / 10 : 0;
  const rawAsr = anyPortalActive ? (sippyStats?.asr ?? 0) : (stats?.asr ?? 0);
  const displayAsr = rawAsr > 0 ? rawAsr : (anyPortalActive && liveAsrEstimate > 0 ? liveAsrEstimate : 0);
  const asrIsLiveEstimate = rawAsr === 0 && anyPortalActive && liveAsrEstimate > 0;
  // ACD: Sippy returns seconds; format for display separately
  const displayAcd = anyPortalActive ? (sippyStats?.acd ?? 0) : (stats?.acd ?? 0);
  const displayPdd = anyPortalActive
    ? (() => {
        const routing = liveCalls.filter((c: any) => c.delay && c.delay > 0);
        return routing.length > 0
          ? parseFloat((routing.reduce((s: number, c: any) => s + c.delay, 0) / routing.length).toFixed(2))
          : 0;
      })()
    : (stats?.pdd ?? 0);

  // MOS: when Sippy is connected, use E-model estimate from probe latency; fall back to local DB
  const displayMos = anyPortalActive
    ? (sippyStats?.estimatedMos ?? null)
    : (stats?.avgMos ?? null);
  const mosLabel = anyPortalActive && sippyStats?.estimatedMos != null ? 'est.' : '';

  // CK ratio: when Sippy is connected, use CDR-derived stats; fall back to local DB
  const displayCkRatio     = anyPortalActive && sippyStats?.ckBreakdown != null
    ? (sippyStats.ckRatio ?? 0)
    : (stats?.ckRatio ?? 0);
  const displayCkBreakdown = anyPortalActive && sippyStats?.ckBreakdown != null
    ? sippyStats.ckBreakdown
    : stats?.ckBreakdown;

  // ── eNER (Estimated Network Effectiveness Ratio) ──────────────────────────
  const displayNer = anyPortalActive ? (sippyStats?.ner ?? null) : null;
  const nerGap     = displayNer != null ? Math.max(0, displayNer - displayAsr) : 0;
  const nerBorder  = notConnected || displayNer == null ? 'border-border/50'
    : displayNer >= 90 ? 'border-emerald-500/20'
    : displayNer >= 75 ? 'border-amber-500/20'
    : 'border-rose-500/20';
  const nerTextCls = notConnected || displayNer == null ? 'text-muted-foreground/40'
    : displayNer >= 90 ? 'text-emerald-400'
    : displayNer >= 75 ? 'text-amber-400'
    : 'text-rose-400';
  const nerStatusLine = notConnected || displayNer == null ? '—'
    : displayNer >= 90 && displayAsr >= 70 ? 'Network healthy · strong answer rate'
    : displayNer >= 90 && displayAsr >= 50 ? 'Network healthy · some user-side gap'
    : displayNer >= 90 ? 'Network healthy · low ASR is user-side'
    : displayNer >= 75 ? 'Network moderate · review carriers'
    : 'Network delivery issues detected';
  const nerTooltip = 'Estimated NER — Network Effectiveness Ratio derived from CDR result codes. Counts as delivered: answered calls, subscriber-busy, ring-no-answer, and terminal rejects. Does not count: routing failures, no-route, or network errors. Differs from ASR because user-side behaviour (busy / no answer) is excluded from failures.';

  // ── Traffic Quality Score (0–100 composite) ───────────────────────────────
  // Weighted: ASR 45% + MOS 30% + CK ratio 15% + PDD penalty 10%
  const trafficScore = anyPortalActive ? Math.min(100, Math.max(0, Math.round(
    displayAsr * 0.45 +
    (displayMos != null ? (displayMos / 5) * 30 : 25) +
    displayCkRatio * 0.15 +
    (displayPdd > 0 ? Math.max(0, (4 - Math.min(displayPdd, 4)) / 4 * 10) : 10)
  ))) : 0;
  const scoreLabel = trafficScore >= 80 ? 'Excellent' : trafficScore >= 60 ? 'Good' : trafficScore >= 40 ? 'Fair' : 'Poor';
  const scoreBorder = trafficScore >= 80 ? 'border-emerald-500/20' : trafficScore >= 60 ? 'border-blue-500/20' : trafficScore >= 40 ? 'border-amber-500/20' : (notConnected ? 'border-border/50' : 'border-rose-500/20');
  const scoreTextCls = trafficScore >= 80 ? 'text-emerald-400' : trafficScore >= 60 ? 'text-blue-400' : trafficScore >= 40 ? 'text-amber-400' : 'text-rose-400';

  // ── Call rate (calls / min) from CDR count over last 1 hr ─────────────────
  const callRatePerMin = sippyStats?.cdrCount && sippyStats.cdrCount > 0
    ? parseFloat((sippyStats.cdrCount / 60).toFixed(1))
    : 0;

  // ── CPS display ────────────────────────────────────────────────────────────
  const displayCps = anyPortalActive ? (sippyStats?.cps ?? 0) : 0;

  // ── Open incidents & system state ─────────────────────────────────────────
  const openIncidents = (activeIncidents ?? []).filter((r: any) => r.status !== 'resolved');
  const criticalCount = openIncidents.filter((r: any) => r.severity === 'critical').length;
  const highCount     = openIncidents.filter((r: any) => r.severity === 'high').length;
  const systemState: 'OPERATIONAL' | 'DEGRADED' | 'CRITICAL' =
    criticalCount > 0 ? 'CRITICAL' :
    (highCount > 0 || (anyPortalActive && trafficScore < 50)) ? 'DEGRADED' : 'OPERATIONAL';

  // ── 15-min delta snapshot — captures a baseline every 15 min ─────────────
  // metricsRef always holds the latest values without causing re-renders
  const [deltaSnap, setDeltaSnap] = useState<{
    ts: number; activeCalls: number; asr: number; mos: number | null;
    pdd: number; acd: number; ner: number | null;
  } | null>(null);
  const metricsRef = useRef({ displayActiveCalls, displayAsr, displayMos, displayPdd, displayAcd, displayNer });
  useEffect(() => {
    metricsRef.current = { displayActiveCalls, displayAsr, displayMos, displayPdd, displayAcd, displayNer };
  }, [displayActiveCalls, displayAsr, displayMos, displayPdd, displayAcd, displayNer]);
  useEffect(() => {
    if (!anyPortalActive) return;
    const snap = () => setDeltaSnap({ ts: Date.now(), ...metricsRef.current });
    snap(); // take the first baseline immediately
    const id = setInterval(snap, 15 * 60_000);
    return () => clearInterval(id);
  }, [anyPortalActive]); // re-run only when portal connect state changes

  // ── Live calls panel state (localStorage-backed) ─────────────────────────
  const [callsPanelOpen, setCallsPanelOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('dash:callsPanel') !== 'false'; } catch { return true; }
  });
  const [callsFilter, setCallsFilter] = useState<'all' | 'connected' | 'routing'>('all');
  const [callDrawer, setCallDrawer] = useState<{ open: boolean; call: any | null }>({ open: false, call: null });

  // ── Traffic Intelligence section state ────────────────────────────────────
  const [trafficSpan,   setTrafficSpan]   = useState<'live' | 'daily' | 'weekly'>('live');
  const [trafficMetric, setTrafficMetric] = useState<'calls' | 'asr' | 'minutes'>('calls');

  // ── KAM/viewer filtered analytics — revenue for assigned clients only ──────
  const kamAnalytics = useMemo(() => {
    const assignedNames = myAccountsData?.clientNames ?? [];
    if (!analyticsData?.byClient?.length || !assignedNames.length) return null;
    const nameSet = new Set(assignedNames.map(n => n.toLowerCase()));
    const matched = analyticsData.byClient.filter(c => nameSet.has(c.name.toLowerCase()));
    if (!matched.length) return null;
    return {
      totalRevenue: matched.reduce((s, c) => s + c.revenue, 0),
      clients: matched,
    };
  }, [analyticsData, myAccountsData]);


  // ── Traffic Intelligence queries — reuse BitsEye backend, zero new API ──────
  const { data: trafficHist, isLoading: trafficHistLoading } = useQuery<{
    points: Array<{ ts: number; label: string; total: number; connected: number; asr: number; minutes: number }>;
    stats: { cur: number; min: number; max: number; avg: number };
  }>({
    queryKey: ['/api/bitseye/entity-history', '__total__', trafficSpan, trafficMetric],
    queryFn: () => fetch(`/api/bitseye/entity-history?dim=client&entity=__total__&span=${trafficSpan}&type=${trafficMetric}`).then(r => r.json()),
    refetchInterval: trafficSpan === 'live' ? 45_000 : 120_000,
    staleTime: 30_000,
  });
  const { data: topClients } = useQuery<{ entities: Array<{ name: string; active: number; connected: number; connectRate: number; idle?: boolean }> }>({
    queryKey: ['/api/bitseye/live-slice', 'client'],
    queryFn: () => fetch('/api/bitseye/live-slice?groupBy=client').then(r => r.json()),
    refetchInterval: 45_000, staleTime: 30_000,
  });
  const { data: topVendors } = useQuery<{ entities: Array<{ name: string; active: number; connected: number; connectRate: number; idle?: boolean }> }>({
    queryKey: ['/api/bitseye/live-slice', 'vendor'],
    queryFn: () => fetch('/api/bitseye/live-slice?groupBy=vendor').then(r => r.json()),
    refetchInterval: 45_000, staleTime: 30_000,
  });
  const { data: topDests } = useQuery<{ entities: Array<{ name: string; active: number; connected: number; connectRate: number; idle?: boolean }> }>({
    queryKey: ['/api/bitseye/live-slice', 'destination'],
    queryFn: () => fetch('/api/bitseye/live-slice?groupBy=destination').then(r => r.json()),
    refetchInterval: 45_000, staleTime: 30_000,
  });
  const { data: topCountries } = useQuery<{ entities: Array<{ name: string; active: number; connected: number; connectRate: number; idle?: boolean }> }>({
    queryKey: ['/api/bitseye/live-slice', 'country'],
    queryFn: () => fetch('/api/bitseye/live-slice?groupBy=country').then(r => r.json()),
    refetchInterval: 45_000, staleTime: 30_000,
  });

  // ── Last refreshed countdown ──────────────────────────────────────────────
  // statsUpdatedAt changes on every successful fetch (even if data is identical),
  // so the timer resets every 20 s — not just when Sippy returns different values.
  const [secsAgo, setSecsAgo] = useState(0);
  useEffect(() => {
    setSecsAgo(0);
    const t = setInterval(() => setSecsAgo(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [statsUpdatedAt]);

  if (!stats) return <div className="p-8">Loading dashboard...</div>;

  // ── Viewer Dashboard ─────────────────────────────────────────────────────────
  // Viewers see only their admin-assigned monitoring items, filtered to their accounts
  if (role === 'viewer') {
    const myItems = new Set(myAssignmentsData?.items ?? []);
    const has = (id: string) => myItems.has(id);
    const assignedLabels = MONITORING_ITEMS.filter(m => myItems.has(m.id));
    const myAccountIds = new Set(myAccountsData?.accountIds ?? []);
    const myClientNames = new Set((myAccountsData?.clientNames ?? []).map((n: string) => n.toLowerCase()));

    // Filter live calls to viewer's assigned accounts (if accounts are configured)
    const viewerLiveCalls = myAccountIds.size > 0
      ? liveCalls.filter((c: any) => myAccountIds.has(String(c.accountId)))
      : liveCalls;

    const groupColors: Record<string, string> = {
      'Live Calls': 'bg-blue-500/15 text-blue-400 border-blue-500/25',
      'Finance':    'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
      'Security':   'bg-red-500/15 text-red-400 border-red-500/25',
      'Operations': 'bg-amber-500/15 text-amber-400 border-amber-500/25',
      'Analytics':  'bg-violet-500/15 text-violet-400 border-violet-500/25',
      'Reports':    'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
    };

    return (
      <div className="space-y-6">
        {/* ── Viewer Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold tracking-tight">My Dashboard</h2>
              {anyPortalActive && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              {user?.email ?? user?.firstName}
              {myAccountsData?.kamName && <span className="ml-2 text-xs text-violet-400">· KAM: {myAccountsData.kamName}</span>}
              {anyPortalActive && <span className="ml-2 text-muted-foreground/60">· refreshed {secsAgo < 60 ? `${secsAgo}s` : `${Math.floor(secsAgo / 60)}m ${secsAgo % 60}s`} ago</span>}
            </p>
            {/* Assignment badges */}
            {assignedLabels.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-xs text-muted-foreground font-medium">Monitoring:</span>
                {assignedLabels.map(item => (
                  <span key={item.id} className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${groupColors[item.group] ?? 'bg-muted/30 text-muted-foreground border-border/50'}`}>
                    {item.label}
                  </span>
                ))}
                {myAccountIds.size > 0 && (
                  <span className="text-xs text-muted-foreground/60 ml-1">· {myAccountIds.size} account{myAccountIds.size !== 1 ? 's' : ''} assigned</span>
                )}
              </div>
            )}
          </div>
          {anyPortalActive && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50">
                <Radio className="w-3 h-3 text-blue-400" />
                <span className="text-muted-foreground">Active:</span>
                <span className="font-bold text-blue-400">{viewerLiveCalls.length}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50">
                <BarChart2 className="w-3 h-3 text-emerald-400" />
                <span className="text-muted-foreground">ASR:</span>
                <span className={`font-bold ${displayAsr >= 10 ? 'text-emerald-400' : displayAsr > 0 ? 'text-amber-400' : 'text-rose-400'}`}>{displayAsr.toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* No assignments */}
        {myItems.size === 0 && (
          <div className="rounded-xl border-2 border-dashed border-muted/40 bg-muted/5 p-10 text-center">
            <Users className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No monitoring items assigned yet.</p>
            <p className="text-muted-foreground/60 text-xs mt-1">Contact your administrator to get access to monitoring features.</p>
          </div>
        )}

        {/* ── live_summary — KPI Cards ──────────────────────────────────────── */}
        {has('live_summary') && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Active Calls */}
            <div className="bg-card border border-blue-500/20 rounded-xl p-5 shadow-lg relative overflow-hidden group hover:border-blue-500/40 transition-all duration-300">
              <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-500">
                <PhoneCall className="w-24 h-24" />
              </div>
              <div className="flex items-center justify-between mb-3 relative z-10">
                <h3 className="text-sm font-medium text-muted-foreground">Active Calls</h3>
                <div className="p-2 bg-secondary/50 rounded-lg"><PhoneCall className="w-4 h-4 text-blue-400" /></div>
              </div>
              <div className="relative z-10">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tracking-tight tabular-nums" data-testid="viewer-active-calls">
                    {notConnected ? '—' : viewerLiveCalls.length}
                  </span>
                  {anyPortalActive && callRatePerMin > 0 && (
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-violet-400/10 text-violet-400">{callRatePerMin}/min</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{anyPortalActive ? `Live calls${myAccountIds.size > 0 ? ' · your accounts' : ''}` : '—'}</p>
              </div>
            </div>
            {/* Network Effectiveness — eNER + ASR combined */}
            <div className={`bg-card border ${nerBorder} rounded-xl p-5 shadow-lg relative overflow-hidden group hover:border-opacity-60 transition-all duration-300`}>
              <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-500">
                <Signal className="w-24 h-24" />
              </div>
              <div className="flex items-center justify-between mb-3 relative z-10">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-medium text-muted-foreground">Network Effectiveness</h3>
                  <Info className="w-3 h-3 text-muted-foreground/40 cursor-help flex-shrink-0" title={nerTooltip} />
                </div>
                <div className="p-2 bg-secondary/50 rounded-lg"><Signal className="w-4 h-4 text-emerald-400" /></div>
              </div>
              <div className="relative z-10 space-y-1.5">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-3xl font-bold tracking-tight tabular-nums ${nerTextCls}`} data-testid="viewer-ener">
                    {notConnected ? '—' : displayNer != null ? `${displayNer.toFixed(1)}%` : '—'}
                  </span>
                  {displayNer != null && !notConnected && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">eNER</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">ASR</span>
                  <span className={`font-semibold tabular-nums ${displayAsr >= 30 ? 'text-emerald-400' : displayAsr > 0 ? 'text-amber-400' : 'text-muted-foreground/50'}`} data-testid="viewer-asr">
                    {notConnected ? '—' : asrIsLiveEstimate ? `~${displayAsr.toFixed(1)}%` : `${displayAsr.toFixed(1)}%`}
                  </span>
                </div>
                {!notConnected && displayNer != null && nerGap > 0 && (
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
                    <span className="text-muted-foreground">Gap</span>
                    <span className="text-muted-foreground tabular-nums">+{nerGap.toFixed(1)}%</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground pt-0.5">{nerStatusLine}</p>
              </div>
            </div>
            {/* Traffic Score */}
            <div className={cn("bg-card border rounded-xl p-5 shadow-lg relative overflow-hidden group hover:border-opacity-60 transition-all duration-300", scoreBorder)}>
              <div className="flex items-center justify-between mb-3 relative z-10">
                <h3 className="text-sm font-medium text-muted-foreground">Traffic Score</h3>
                <div className="p-2 bg-secondary/50 rounded-lg"><Award className="w-4 h-4 text-amber-400" /></div>
              </div>
              <div className="relative z-10">
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-3xl font-bold tracking-tight tabular-nums", notConnected ? 'text-muted-foreground/40' : scoreTextCls)}>{notConnected ? '—' : trafficScore}</span>
                  {!notConnected && <span className="text-sm text-muted-foreground">/100</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{notConnected ? '—' : `${scoreLabel} · composite`}</p>
              </div>
              {!notConnected && (
                <div className="mt-3 h-1 rounded-full bg-muted/40 overflow-hidden relative z-10">
                  <div className={cn("h-full rounded-full transition-all duration-700", trafficScore >= 80 ? 'bg-emerald-500' : trafficScore >= 60 ? 'bg-blue-500' : trafficScore >= 40 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${trafficScore}%` }} />
                </div>
              )}
            </div>
            {/* MOS */}
            <StatCard
              title="Avg MOS"
              value={notConnected ? '—' : displayMos != null ? displayMos.toFixed(2) : '—'}
              icon={Activity}
              className={displayMos != null && displayMos > 4 ? "border-emerald-500/20" : "border-amber-500/20"}
              description={anyPortalActive ? "E-model estimate" : "Mean Opinion Score"}
            />
          </div>
        )}

        {/* ── live_details — Live Calls Table ──────────────────────────────── */}
        {has('live_details') && (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="p-5 border-b border-border/50 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-blue-500" />
                {anyPortalActive
                  ? `Live Calls (${viewerLiveCalls.length}${myAccountIds.size > 0 && liveCalls.length !== viewerLiveCalls.length ? ` of ${liveCalls.length} total` : ''})`
                  : 'Live Calls'}
                {myAccountIds.size > 0 && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                    Your Accounts
                  </span>
                )}
              </h3>
              <Link href="/calls" className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                Full View <ArrowRight className="ml-1 w-4 h-4" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              {anyPortalActive ? (
                viewerLiveCalls.length === 0 ? (
                  <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                    {myAccountIds.size > 0 ? 'No active calls for your assigned accounts right now.' : 'No active calls right now.'}
                  </div>
                ) : (
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground font-medium">
                      <tr>
                        <th className="px-6 py-3">Caller</th>
                        <th className="px-6 py-3">Callee</th>
                        <th className="px-6 py-3">Account</th>
                        <th className="px-6 py-3">State</th>
                        <th className="px-6 py-3">Duration</th>
                        <th className="px-6 py-3">Answer Type</th>
                        <th className="px-6 py-3">Setup Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {viewerLiveCalls.slice(0, 30).map((call: any, i: number) => (
                        <LiveCallRow key={call.callId || i} call={call} index={i} />
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">Connect to softswitch to see live calls.</div>
              )}
            </div>
          </div>
        )}

        {/* ── balance_monitor — Revenue & Margin Analytics (viewer) ──────── */}
        {has('balance_monitor') && anyPortalActive && (
          <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/40 bg-muted/10">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue &amp; Margin Analytics</span>
                {myAccountsData?.kamName && (
                  <span className="text-[10px] text-muted-foreground/60 normal-case ml-1">— {myAccountsData.kamName}'s clients</span>
                )}
              </div>
            </div>
            <div className="px-5 py-4">
              {kamAnalytics ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-5 py-3 flex items-center gap-3">
                      <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Your Clients Revenue</p>
                        <p className="text-2xl font-bold text-emerald-400 tabular-nums">${kamAnalytics.totalRevenue.toFixed(2)}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Last 30 days · {kamAnalytics.clients.length} client{kamAnalytics.clients.length !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {kamAnalytics.clients.map(c => (
                      <div key={c.name} className="bg-card border border-border/50 rounded-lg px-3 py-2 text-center min-w-[100px]">
                        <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{c.name}</p>
                        <p className="text-sm font-bold text-emerald-400 tabular-nums">${c.revenue.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground text-sm py-2">
                  {analyticsData ? 'No revenue data for your assigned clients in the last 30 days' : 'Loading analytics…'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── graphs — ASR/ACD Trend + Call Back Ratio ─────────────────────── */}
        {has('graphs') && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* ASR / ACD Trend */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    ASR &amp; ACD Trend
                    {myClientNames.size > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">Your Accounts</span>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Answer-Seizure Ratio (%) + Avg Call Duration (s)</p>
                </div>
                <select
                  className="bg-background border border-border rounded-md text-xs px-2 py-1"
                  value={trendHours}
                  onChange={e => setTrendHours(Number(e.target.value))}
                  data-testid="viewer-select-trend-window"
                >
                  <option value={1}>Last 1h</option>
                  <option value={6}>Last 6h</option>
                  <option value={24}>Last 24h</option>
                </select>
              </div>
              <div className="h-[260px] w-full">
                {chartData.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <Activity className="w-8 h-8 opacity-30" />
                    <p className="text-sm text-center">
                      {notConnected
                        ? 'Connect to softswitch to see live trends.'
                        : 'CDR monitoring data unavailable — requires XML-RPC API access.'}
                    </p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={chartData} margin={{ top: 6, right: 40, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorAsrGV" x1="0" y1="0" x2="0" y2="1">
                          <BseGradStops color="#10b981" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...BSE_GRID_PROPS} />
                      <XAxis dataKey="time" {...BSE_AXIS_PROPS} interval="preserveStartEnd" />
                      <YAxis yAxisId="asr" orientation="left" {...BSE_AXIS_PROPS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={36} />
                      <YAxis yAxisId="acd" orientation="right" {...BSE_AXIS_PROPS} tickFormatter={(v) => `${v}s`} width={36} />
                      <Tooltip content={<BseTooltip formatter={(v, key) => key === 'asr' ? [`${v}%`, 'ASR'] : [`${v}s`, 'ACD']} />} cursor={BSE_CURSOR} />
                      <Area yAxisId="asr" type="monotone" dataKey="asr" stroke="#10b981" strokeWidth={2.5} fill="url(#colorAsrGV)" dot={false} activeDot={bseActiveDot('#10b981')} strokeLinejoin="round" strokeLinecap="round" />
                      <Line yAxisId="acd" type="monotone" dataKey="acd" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={bseActiveDot('#a78bfa', 3)} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Call Back Ratio */}
            <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4 border-b border-border/50">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm tracking-wide uppercase text-muted-foreground">Call Back Ratio</h3>
                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">FAS Deduction</span>
                  </div>
                  <p className="text-xs text-muted-foreground/70">Calls answered by user ÷ total attempts · deducting failed calls</p>
                </div>
                <span className={`text-4xl font-bold font-mono tabular-nums ${notConnected ? 'text-muted-foreground/40' : displayCkRatio >= 80 ? 'text-emerald-400' : displayCkRatio >= 60 ? 'text-amber-400' : 'text-rose-400'}`}>{notConnected ? '—' : `${displayCkRatio.toFixed(1)}%`}</span>
              </div>
              {!notConnected && displayCkBreakdown && (
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/50">
                  <div className="flex flex-col items-center gap-1.5 py-5 px-4">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Connected</span>
                    <span className="text-2xl font-bold text-emerald-400 tabular-nums">{(displayCkBreakdown?.connected ?? 0).toLocaleString()}</span>
                    <span className="text-xs text-center text-muted-foreground">Answered by user</span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5 py-5 px-4">
                    <PhoneMissed className="w-5 h-5 text-rose-400" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Wrong No.</span>
                    <span className="text-2xl font-bold text-rose-400 tabular-nums">{(displayCkBreakdown?.wrongNumber ?? 0).toLocaleString()}</span>
                    <span className="text-xs text-center text-muted-foreground">Invalid / misrouted</span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5 py-5 px-4">
                    <PhoneOff className="w-5 h-5 text-orange-400" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Switched Off</span>
                    <span className="text-2xl font-bold text-orange-400 tabular-nums">{(displayCkBreakdown?.switchedOff ?? 0).toLocaleString()}</span>
                    <span className="text-xs text-center text-muted-foreground">Device unreachable</span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5 py-5 px-4">
                    <Signal className="w-5 h-5 text-amber-400" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Untraceable</span>
                    <span className="text-2xl font-bold text-amber-400 tabular-nums">{(displayCkBreakdown?.untraceable ?? 0).toLocaleString()}</span>
                    <span className="text-xs text-center text-muted-foreground">No network / signal</span>
                  </div>
                </div>
              )}
              {!notConnected && (displayCkBreakdown?.total ?? 0) > 0 && (
                <div className="px-6 pb-5 pt-2 space-y-2">
                  <div className="h-2.5 rounded-full overflow-hidden bg-muted/30 flex">
                    <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${(displayCkBreakdown?.connected ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }} />
                    <div className="bg-rose-500 h-full transition-all duration-500" style={{ width: `${(displayCkBreakdown?.wrongNumber ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }} />
                    <div className="bg-orange-500 h-full transition-all duration-500" style={{ width: `${(displayCkBreakdown?.switchedOff ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }} />
                    <div className="bg-amber-500 h-full transition-all duration-500" style={{ width: `${(displayCkBreakdown?.untraceable ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground/60">
                    <span><span className="text-muted-foreground font-medium">{(displayCkBreakdown?.total ?? 0).toLocaleString()}</span> {anyPortalActive && sippyStats?.ckBreakdown != null ? 'calls last hour (Sippy CDRs)' : 'total attempts today'}</span>
                    <span>Failed: <span className="text-rose-400 font-medium">{((displayCkBreakdown?.total ?? 0) - (displayCkBreakdown?.connected ?? 0)).toLocaleString()}</span></span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── fraud_fas — FAS Events ─────────────────────────────────────────── */}
        {has('fraud_fas') && recentFasEvents.length > 0 && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-rose-500/15">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <h3 className="font-semibold text-sm text-rose-300">FAS Detections</h3>
              <span className="ml-1 text-xs text-rose-400/70">— False Answer Supervision</span>
            </div>
            <div className="divide-y divide-rose-500/10">
              {recentFasEvents.map((ev: any) => {
                const reasons: string[] = (ev.reason ?? '').split(',').map((r: string) => r.trim()).filter(Boolean);
                return (
                  <div key={ev.id} className="flex items-center gap-4 px-5 py-2.5 text-xs hover:bg-rose-500/5">
                    <div className="text-muted-foreground/60 w-28">{formatUTC(new Date(ev.detectedAt), 'dd MMM HH:mm:ss')}</div>
                    <div className="min-w-[90px]"><span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary/80">{ev.clientName || 'Unknown'}</span></div>
                    <div className="font-mono text-muted-foreground truncate">{ev.caller ?? '—'} <span className="text-muted-foreground/40">→</span> {ev.callee ?? '—'}</div>
                    <div className="ml-auto flex items-center gap-1.5">
                      {reasons.map(r => (
                        <span key={r} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${r === 'high_pdd' ? 'bg-orange-500/15 text-orange-400' : r === 'zero_billed' ? 'bg-red-500/15 text-red-400' : r === 'short_billed' ? 'bg-violet-500/15 text-violet-400' : r === 'early_answer' ? 'bg-yellow-500/15 text-yellow-400' : 'bg-muted/30 text-muted-foreground'}`}>{r.replace(/_/g, ' ')}</span>
                      ))}
                      <span className="ml-1 text-rose-400 font-bold">Score {ev.fraudScore ?? 0}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    );
  }

  // ── System state color helpers ─────────────────────────────────────────────
  const stateBadgeCls = systemState === 'CRITICAL'
    ? 'text-rose-400 bg-rose-500/10 border-rose-500/25'
    : systemState === 'DEGRADED'
    ? 'text-amber-400 bg-amber-500/10 border-amber-500/25'
    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';
  const stateCardBorderCls = !anyPortalActive ? 'border-border/50'
    : systemState === 'CRITICAL' ? 'border-rose-500/30'
    : systemState === 'DEGRADED' ? 'border-amber-500/30'
    : 'border-emerald-500/20';
  const stateValueCls = !anyPortalActive ? 'text-muted-foreground/30'
    : systemState === 'CRITICAL' ? 'text-rose-400'
    : systemState === 'DEGRADED' ? 'text-amber-400'
    : 'text-emerald-400';

  // ── Derived counts for portal KPI cards ─────────────────────────────────
  const degradedCarrierCount = (carrierScoresRaw ?? []).filter((c: any) => (c.score ?? c.overallScore ?? 100) < 60).length;
  const carrierCriticalCount = (carrierScoresRaw ?? []).filter((c: any) => (c.score ?? c.overallScore ?? 100) < 40).length;

  // ── System health items — derived from live query states ─────────────────
  const systemHealthItems = [
    {
      label: 'Database',
      ok: !!stats,
      value: stats ? 'OK' : '—',
      detail: stats ? 'Connected' : 'Checking...',
      icon: Server,
      href: '/server-monitoring',
    },
    {
      label: 'Sippy',
      ok: anyPortalActive,
      value: anyPortalActive ? 'Live' : 'Off',
      detail: anyPortalActive ? (sippySession?.username ?? 'Connected') : 'Disconnected',
      icon: Globe,
      href: '/settings',
    },
    {
      label: 'Live Calls',
      ok: sippyLiveCalls?.connected !== false,
      value: liveCallsFreshness === 'fresh' ? 'Fresh' : liveCallsFreshness === 'delay' ? 'Delay' : liveCallsFreshness === 'stale' ? 'Stale' : '—',
      detail: `${liveCalls.length} active`,
      icon: PhoneCall,
      href: '/calls',
    },
    {
      label: 'WebSocket',
      ok: true,
      value: 'Live',
      detail: lastTick ? `tick ${new Date(lastTick).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Listening',
      icon: Activity,
      href: '/noc-command',
    },
    {
      label: 'Poll Engine',
      ok: secsAgo < 180,
      value: secsAgo < 60 ? `${secsAgo}s` : `${Math.floor(secsAgo / 60)}m`,
      detail: secsAgo < 60 ? 'Fresh' : secsAgo < 180 ? 'Active' : 'Check needed',
      icon: RefreshCw,
      href: '/server-monitoring',
    },
    {
      label: 'Fraud Engine',
      ok: true,
      value: fasAll.length > 0 ? String(fasAll.length) : 'Clean',
      detail: fasAll.length > 0 ? `${fasAll.length} FAS events` : 'No events',
      icon: ShieldAlert,
      href: '/fraud-engine',
    },
  ] as const;

  // ── Risk destinations — low connect-rate active destinations ─────────────
  const riskDests = (topDests?.entities ?? [])
    .filter(e => e.active > 0 && e.connectRate < 80)
    .sort((a, b) => a.connectRate - b.connectRate)
    .slice(0, 6);

  // ── Live operational feed — incidents + FAS events merged ─────────────────
  type FeedItem = { id: string; ts: number; severity: string; label: string; detail: string; module: string; href: string };
  const feedItems: FeedItem[] = [
    ...(openIncidents).map((inc: any) => ({
      id: `inc-${inc.id}`,
      ts: new Date(inc.createdAt || inc.detectedAt || Date.now()).getTime(),
      severity: inc.severity ?? 'info',
      label: inc.title || inc.entityName || 'Incident',
      detail: inc.description || '',
      module: 'Operations',
      href: `/incidents/${inc.id}`,
    })),
    ...(recentFasEvents).map((ev: any) => ({
      id: `fas-${ev.id}`,
      ts: new Date(ev.detectedAt).getTime(),
      severity: 'high',
      label: `FAS alert: ${ev.clientName || 'Unknown'} — suspicious traffic`,
      detail: `CLI: ${ev.caller || '—'} · Duration: ${ev.duration || '—'}s`,
      module: 'Fraud Engine',
      href: '/fraud-engine',
    })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 6);

  const SEVE_CLS: Record<string, string> = {
    critical: 'bg-red-500/15 text-red-500 border-red-500/30',
    high:     'bg-amber-500/15 text-amber-500 border-amber-500/30',
    medium:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
    low:      'bg-muted/40 text-muted-foreground border-border',
    info:     'bg-muted/40 text-muted-foreground border-border',
  };

  // ── Workflow card definitions ──────────────────────────────────────────────
  const PRIMARY_WORKFLOWS = [
    {
      id: 'vendor-rca',
      href: '/carrier-scoring',
      label: 'Vendor RCA',
      desc: 'Real-time vendor performance & RCA',
      icon: TrendingDown,
      severity: degradedCarrierCount > 0 ? (carrierCriticalCount > 0 ? 'critical' : 'high') : 'good',
      stat1: { value: String(degradedCarrierCount), label: 'Degraded' },
      stat2: { value: String(carrierCriticalCount), label: 'Critical' },
    },
    {
      id: 'routing-manager',
      href: '/routing-manager',
      label: 'Routing Manager',
      desc: 'Routing configuration & management',
      icon: Radio,
      severity: openIncidents.some((i: any) => (i.entityType === 'route' || i.entityType === 'routing') && i.severity === 'high') ? 'high' : 'good',
      stat1: { value: '—', label: 'Routes' },
      stat2: { value: openIncidents.filter((i: any) => i.entityType === 'route').length > 0 ? String(openIncidents.filter((i: any) => i.entityType === 'route').length) : '—', label: 'Updates' },
    },
    {
      id: 'noc-command',
      href: '/noc-command',
      label: 'NOC Command',
      desc: 'Live incidents & command center',
      icon: Monitor,
      severity: criticalCount > 0 ? 'critical' : highCount > 0 ? 'high' : 'good',
      stat1: { value: String(displayActiveCalls), label: 'Active Calls' },
      stat2: { value: String(openIncidents.length), label: 'Incidents' },
    },
    {
      id: 'prefix-intel',
      href: '/prefix-intelligence',
      label: 'Prefix Intelligence',
      desc: 'Prefix analysis & optimization',
      icon: ScanSearch,
      severity: 'good',
      stat1: { value: '—', label: 'Monitored' },
      stat2: { value: anyPortalActive ? '✓' : '—', label: 'Healthy' },
    },
    {
      id: 'stability',
      href: '/stability-timeline',
      label: 'Stability Timeline',
      desc: 'Vendor stability & quality trends',
      icon: Activity,
      severity: degradedCarrierCount > 2 ? 'high' : 'good',
      stat1: { value: String(degradedCarrierCount), label: 'Unstable' },
      stat2: { value: String((carrierScoresRaw ?? []).length), label: 'Tracked' },
    },
    {
      id: 'recommendations',
      href: '/ai-ops',
      label: 'Recommendations',
      desc: 'AI-powered routing recommendations',
      icon: Zap,
      severity: criticalCount > 0 ? 'critical' : 'good',
      stat1: { value: String(openIncidents.length > 0 ? openIncidents.length : '—'), label: 'Open' },
      stat2: { value: String(criticalCount > 0 ? criticalCount : '—'), label: 'Critical' },
    },
  ] as const;

  const SECONDARY_WORKFLOWS = [
    {
      id: 'carrier-intel',
      href: '/carrier-intelligence',
      label: 'Carrier Intel',
      desc: 'Carrier performance intelligence',
      icon: BarChart2,
      stat: { value: String((carrierScoresRaw ?? []).length) + '+', label: 'Carriers' },
    },
    {
      id: 'ai-ops',
      href: '/ai-ops',
      label: 'AI Operations',
      desc: 'AI-powered operations intelligence',
      icon: Zap,
      stat: { value: '—', label: 'Active Models' },
    },
    {
      id: 'fraud-engine',
      href: '/fraud-engine',
      label: 'Fraud Engine',
      desc: 'Fraud detection & prevention',
      icon: ShieldAlert,
      stat: { value: String(recentFasEvents.length > 0 ? recentFasEvents.length : '—'), label: 'FAS Events' },
    },
    {
      id: 'approvals',
      href: '/approval-queue',
      label: 'Approvals',
      desc: 'Pending approvals management',
      icon: CheckCircle2,
      stat: { value: String(pendingCount > 0 ? pendingCount : '—'), label: 'Pending' },
    },
  ] as const;

  const QUICK_ACTIONS = [
    { href: '/alerts',            icon: AlertTriangle,  label: 'Create Alert'    },
    { href: '/balance',           icon: DollarSign,     label: 'Check Balance'   },
    { href: '/routing-manager',   icon: Radio,          label: 'Add Route'       },
    { href: '/reports',           icon: FileSpreadsheet,label: 'Generate Report' },
    { href: '/server-monitoring', icon: Server,         label: 'System Health'   },
  ] as const;

  const sevLabel = (s: string) => s === 'critical' ? 'Critical' : s === 'high' ? 'High' : s === 'good' ? 'Healthy' : 'Info';
  const sevBadge = (s: string) =>
    s === 'critical' ? 'bg-red-500/15 text-red-500 border-red-500/30'
    : s === 'high'   ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    : s === 'good'   ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
    :                  'bg-muted/40 text-muted-foreground border-border';

  return (
    <div className="space-y-6">

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight">Live Operations</h2>
            {anyPortalActive ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-muted/30 text-muted-foreground border border-border/40">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                OFFLINE
              </span>
            )}
            {anyPortalActive && (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${stateBadgeCls}`}
                data-testid="text-system-state-badge">
                {systemState}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Sippy Softswitch ·{' '}
            <span className="font-mono text-xs">
              {sippySession?.username
                ? sippySession.username
                : anyPortalActive ? 'connected' : 'not connected'}
            </span>
            {anyPortalActive && (
              <span className="ml-2 text-muted-foreground/60">· refreshed {secsAgo < 60 ? `${secsAgo}s` : `${Math.floor(secsAgo / 60)}m ${secsAgo % 60}s`} ago</span>
            )}
          </p>
        </div>

        {/* Customize button */}
        <button
          onClick={() => setCustomizeOpen(true)}
          data-testid="button-customize-dashboard"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 bg-card/60 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          Customize
        </button>

        {/* NOC Clock */}
        <div className="relative" data-testid="noc-clock">
          <div
            className="flex flex-col items-end cursor-pointer select-none rounded-xl border border-border/50 bg-card/70 px-4 py-2 hover:bg-muted/30 transition-colors"
            onClick={() => setTzPickerOpen(o => !o)}
            data-testid="button-clock-tz-edit"
            title="Click to change timezone"
          >
            <span className="font-mono text-2xl font-bold tabular-nums leading-none tracking-tight text-foreground">
              {clockDisplay.time || '--:--:--'}
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[11px] text-muted-foreground font-mono">{clockDisplay.date}</span>
              <span className="text-[11px] font-semibold text-indigo-400 font-mono">{clockDisplay.abbr || tzAbbr}</span>
              <Pencil className="h-2.5 w-2.5 text-indigo-400/60" />
            </div>
          </div>
          {tzPickerOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setTzPickerOpen(false)} />
              <div className="absolute top-full right-0 mt-1.5 w-56 rounded-xl border border-border/60 bg-card shadow-xl z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-border/40 bg-muted/30 flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-indigo-400" />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">App Timezone</p>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {TZ_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setTz(opt.value); setTzPickerOpen(false); }}
                      className={`w-full px-3 py-2 flex items-center justify-between text-left hover:bg-muted/50 transition-colors ${tz === opt.value ? 'bg-indigo-500/10 text-indigo-400' : ''}`}
                      data-testid={`button-tz-${opt.value}`}
                    >
                      <span className="text-sm font-medium">{opt.label}</span>
                      <span className="text-xs text-muted-foreground font-mono">{opt.offset}</span>
                    </button>
                  ))}
                </div>
                <div className="px-3 py-2 border-t border-border/30 bg-muted/10">
                  <p className="text-[10px] text-muted-foreground/60">Applied to all reports & timestamps</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Connection Banner ───────────────────────────────────────────────── */}
      {notConnected && (
        <div className="rounded-xl border-2 border-dashed border-violet-500/40 bg-violet-500/5 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-violet-500/15 flex items-center justify-center flex-shrink-0">
              <Globe className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <p className="font-semibold text-sm">No live data source connected</p>
              <p className="text-xs text-muted-foreground mt-1">
                Simulation is disabled. Connect to your Sippy softswitch to see real call data, CDR records, and traffic stats here.
              </p>
            </div>
          </div>
          <Link href="/settings"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-colors whitespace-nowrap flex-shrink-0">
            <Settings className="w-3.5 h-3.5" />
            Connect Softswitch
          </Link>
        </div>
      )}
      {!notConnected && anyPortalActive && sippyStats?.credsMissing === true && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-200">XML-RPC API access not configured</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                CDR metrics, ASR trend, and traffic analytics require the XML-RPC API password. Enter it in Settings.
              </p>
            </div>
          </div>
          <Link href="/settings"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/80 text-white text-xs font-medium hover:bg-amber-500/80 transition-colors whitespace-nowrap flex-shrink-0"
            data-testid="link-settings-cdr-fix">
            <Settings className="w-3 h-3" />
            Open Settings
          </Link>
        </div>
      )}

      {/* ── 4 KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Active Calls */}
        <Link href="/calls" data-testid="card-kpi-active-calls">
        <div className="bg-card border border-blue-500/20 rounded-xl p-5 hover:border-blue-500/40 hover:shadow-md transition-all duration-200 group relative overflow-hidden cursor-pointer">
          <div className="absolute top-0 right-0 p-4 opacity-[0.04] group-hover:opacity-[0.08] transition-opacity"><PhoneCall className="w-20 h-20" /></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Calls</span>
            <div className="p-1.5 rounded-lg bg-blue-500/10"><PhoneCall className="w-3.5 h-3.5 text-blue-400" /></div>
          </div>
          <div className="relative z-10">
            <div className="text-3xl font-bold tabular-nums tracking-tight" data-testid="kpi-active-calls-value">
              {notConnected ? '—' : <AnimatedCount value={displayActiveCalls} />}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {anyPortalActive ? (callRatePerMin > 0 ? `${callRatePerMin}/min · live` : 'live · connected') : 'not connected'}
            </p>
          </div>
        </div>
        </Link>

        {/* Active Alerts */}
        <Link href="/alerts" data-testid="card-kpi-active-alerts">
        <div className={`bg-card border rounded-xl p-5 transition-all duration-200 group relative overflow-hidden cursor-pointer hover:shadow-md ${(alertsCount + openIncidents.length) > 0 ? 'border-amber-500/30 hover:border-amber-500/50' : 'border-border/50 hover:border-border'}`}>
          <div className="absolute top-0 right-0 p-4 opacity-[0.04] group-hover:opacity-[0.08] transition-opacity"><AlertTriangle className="w-20 h-20" /></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Alerts</span>
            <div className={`p-1.5 rounded-lg ${(alertsCount + openIncidents.length) > 0 ? 'bg-amber-500/10' : 'bg-muted/40'}`}>
              <AlertTriangle className={`w-3.5 h-3.5 ${(alertsCount + openIncidents.length) > 0 ? 'text-amber-400' : 'text-muted-foreground'}`} />
            </div>
          </div>
          <div className="relative z-10">
            <div className={`text-3xl font-bold tabular-nums tracking-tight ${(alertsCount + openIncidents.length) > 0 ? 'text-amber-400' : ''}`} data-testid="kpi-alerts-value">
              {alertsCount + openIncidents.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {openIncidents.length > 0 ? `${criticalCount > 0 ? `${criticalCount} critical · ` : ''}${openIncidents.length} open` : 'all clear'}
            </p>
          </div>
        </div>
        </Link>

        {/* Degraded Carriers */}
        <Link href="/carrier-intelligence" data-testid="card-kpi-degraded-carriers">
        <div className={`bg-card border rounded-xl p-5 transition-all duration-200 group relative overflow-hidden cursor-pointer hover:shadow-md ${degradedCarrierCount > 0 ? 'border-rose-500/25 hover:border-rose-500/40' : 'border-border/50 hover:border-border'}`}>
          <div className="absolute top-0 right-0 p-4 opacity-[0.04] group-hover:opacity-[0.08] transition-opacity"><TrendingDown className="w-20 h-20" /></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Degraded Carriers</span>
            <div className={`p-1.5 rounded-lg ${degradedCarrierCount > 0 ? 'bg-rose-500/10' : 'bg-muted/40'}`}>
              <TrendingDown className={`w-3.5 h-3.5 ${degradedCarrierCount > 0 ? 'text-rose-400' : 'text-muted-foreground'}`} />
            </div>
          </div>
          <div className="relative z-10">
            <div className={`text-3xl font-bold tabular-nums tracking-tight ${degradedCarrierCount > 0 ? 'text-rose-400' : ''}`} data-testid="kpi-degraded-value">
              {anyPortalActive ? degradedCarrierCount : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {anyPortalActive ? (carrierCriticalCount > 0 ? `${carrierCriticalCount} critical · score < 40` : degradedCarrierCount > 0 ? 'score below 60' : 'all carriers healthy') : 'not connected'}
            </p>
          </div>
        </div>
        </Link>

        {/* Pending Approvals */}
        <Link href="/approval-queue" data-testid="card-kpi-pending-approvals">
        <div className={`bg-card border rounded-xl p-5 transition-all duration-200 group relative overflow-hidden cursor-pointer hover:shadow-md ${pendingCount > 0 ? 'border-violet-500/25 hover:border-violet-500/40' : 'border-border/50 hover:border-border'}`}>
          <div className="absolute top-0 right-0 p-4 opacity-[0.04] group-hover:opacity-[0.08] transition-opacity"><CheckCircle2 className="w-20 h-20" /></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pending Approvals</span>
            <div className={`p-1.5 rounded-lg ${pendingCount > 0 ? 'bg-violet-500/10' : 'bg-muted/40'}`}>
              <CheckCircle2 className={`w-3.5 h-3.5 ${pendingCount > 0 ? 'text-violet-400' : 'text-muted-foreground'}`} />
            </div>
          </div>
          <div className="relative z-10">
            <div className={`text-3xl font-bold tabular-nums tracking-tight ${pendingCount > 0 ? 'text-violet-400' : ''}`} data-testid="kpi-approvals-value">
              {pendingCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {pendingCount > 0 ? 'require review' : 'queue empty'}
            </p>
          </div>
        </div>
        </Link>

      </div>

      {/* ── Live Telemetry Grid ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Live Telemetry</span>
          <div className="flex-1 h-px bg-blue-500/15" />
        </div>
        <div className="flex gap-5 items-start">

          {/* LEFT — Traffic Graph */}
          <div className="flex-1 min-w-0">

            {/* Traffic Graph */}
            <div className="rounded-xl border border-blue-500/20 bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
                <div className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full ${anyPortalActive ? 'bg-blue-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
                  <h3 className="font-semibold text-sm">Total Traffic</h3>
                  <span className="text-[11px] text-muted-foreground">
                    {displayActiveCalls > 0 ? `${displayActiveCalls} calls · ` : ''}
                    {sippyStats?.cps ? `${sippyStats.cps.toFixed(1)} CPS · ` : ''}
                    ASR {displayAsr.toFixed(1)}%
                    {displayAcd > 0 ? ` · ACD ${Math.floor(displayAcd / 60)}m ${displayAcd % 60}s` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-0.5">
                    {([['live', 'LIVE'], ['daily', '24H'], ['weekly', '7D']] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setTrafficSpan(val)}
                        className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${trafficSpan === val ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-muted-foreground hover:text-foreground'}`}
                        data-testid={`btn-traffic-span-${val}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-0.5">
                    {([['calls', 'Calls'], ['asr', 'ASR'], ['minutes', 'Min']] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setTrafficMetric(val)}
                        className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${trafficMetric === val ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        data-testid={`btn-traffic-metric-${val}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Link href="/bitseye2" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 ml-1 whitespace-nowrap">
                    Explore <ExternalLink className="w-2.5 h-2.5" />
                  </Link>
                </div>
              </div>
              <div className="px-5 py-4">
                {trafficHistLoading ? (
                  <div className="h-24 rounded bg-muted/20 animate-pulse" />
                ) : (trafficHist?.points ?? []).length === 0 ? (
                  <div className="h-24 flex items-center justify-center text-sm text-muted-foreground/40">
                    {anyPortalActive ? 'Collecting data…' : 'Connect a softswitch to see traffic'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={(trafficHist.points).map(p => ({
                      label: p.label,
                      value: trafficMetric === 'asr' ? p.asr : trafficMetric === 'minutes' ? p.minutes : p.total,
                      connected: p.connected,
                    }))}>
                      <defs>
                        <linearGradient id="dashTrafficGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'rgba(148,163,184,0.5)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis hide />
                      <Tooltip
                        content={({ active, payload }) => active && payload?.[0] ? (
                          <div className="bg-card border border-border/60 rounded-lg px-3 py-2 text-xs shadow-lg">
                            <p className="text-muted-foreground">{payload[0].payload.label}</p>
                            <p className="font-semibold text-blue-400 mt-0.5">
                              {payload[0].value as number}{trafficMetric === 'asr' ? '%' : trafficMetric === 'minutes' ? ' min' : ' calls'}
                            </p>
                          </div>
                        ) : null}
                      />
                      <Area type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={2} fill="url(#dashTrafficGrad)" dot={false} activeDot={{ r: 3, fill: '#3B82F6' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT — Top Clients / Vendors / Routes */}
          <div className="w-[300px] shrink-0 space-y-3">
            <DashTopEntityCard
              title="Top Clients"
              icon="users"
              entities={(topClients?.entities ?? []).filter(e => !e.idle)}
              dim="client"
              color="violet"
              loading={!topClients}
            />
            <DashTopEntityCard
              title="Top Vendors"
              icon="radio"
              entities={(topVendors?.entities ?? []).filter(e => !e.idle)}
              dim="vendor"
              color="blue"
              loading={!topVendors}
            />
            <DashTopEntityCard
              title="Top Routes"
              icon="globe"
              entities={(topDests?.entities ?? []).filter(e => !e.idle)}
              dim="destination"
              color="emerald"
              loading={!topDests}
            />
          </div>

        </div>

        {/* ── Full-width sections ───────────────────────────────────────────── */}
        <div className="space-y-4 mt-4">

        {/* Live Calls Table */}
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
            <div className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full ${liveCalls.length > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
                  <h3 className="font-semibold text-sm">Live Calls</h3>
                  {liveCalls.length > 0 && (
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 font-semibold">{liveCalls.length} active</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-0.5">
                    {([['all', 'All'], ['connected', 'Connected'], ['routing', 'Routing']] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setCallsFilter(val)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${callsFilter === val ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        data-testid={`btn-calls-filter-${val}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Link href="/calls" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 whitespace-nowrap">
                    View all <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
              {liveCalls.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <PhoneCall className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground/50">{anyPortalActive ? 'No active calls right now' : 'Connect a softswitch to see live calls'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border/40 bg-muted/20">
                        {['Caller', 'Callee', 'Client', 'State', 'Duration', 'Answer', 'Time'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {liveCalls
                        .filter((c: any) => callsFilter === 'all' || (callsFilter === 'connected' ? c.callStatus === 'connected' : c.callStatus !== 'connected'))
                        .slice(0, 12)
                        .map((call: any, i: number) => {
                          const isConnected = call.callStatus === 'connected';
                          const setupMs = call.setupTime ? (() => { let s = call.setupTime.trim().replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T').replace(/T(\d{2})(\d{2})(\d{2})/, 'T$1:$2:$3'); return new Date(s).getTime(); })() : null;
                          const elapsedSec = setupMs ? Math.max(0, Math.floor((Date.now() - setupMs) / 1000)) : parseFloat(call.duration ?? 0);
                          const durLabel = elapsedSec > 0 ? (Math.floor(elapsedSec / 60) > 0 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`) : '0s';
                          const answerCls = !isConnected ? 'bg-amber-500/15 text-amber-400' : elapsedSec < 3 ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400';
                          const answerLabel = !isConnected ? 'Routing' : elapsedSec < 3 ? 'FAS Risk' : 'Real Answer';
                          const timeStr = call.setupTime ? call.setupTime.replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3 ').replace(/\.\d+$/, '').slice(-8) : '—';
                          return (
                            <tr
                              key={i}
                              className="border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer group"
                              onClick={() => setCallDrawer({ open: true, call })}
                              data-testid={`row-dash-call-${i}`}
                            >
                              <td className="px-4 py-2.5 font-mono text-xs text-foreground/80 group-hover:text-foreground transition-colors">{call.caller || '—'}</td>
                              <td className="px-4 py-2.5 font-mono text-xs text-foreground/80 group-hover:text-foreground transition-colors">{call.callee || '—'}</td>
                              <td className="px-4 py-2.5 text-xs text-violet-400">{call.clientName || call.accountId || '—'}</td>
                              <td className="px-4 py-2.5 text-xs">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                                  {call.ccState || call.callStatus || '—'}
                                </span>
                              </td>
                              <td className={`px-4 py-2.5 text-xs font-mono ${isConnected && elapsedSec < 3 ? 'text-red-400 font-semibold' : 'text-muted-foreground'}`}>{durLabel}</td>
                              <td className="px-4 py-2.5 text-xs">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${answerCls}`}>{answerLabel}</span>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground/60 font-mono">{timeStr}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Traffic Geography ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-blue-400/70" />
                  <h3 className="font-semibold text-sm">Traffic Geography</h3>
                  {(() => {
                    const active = (topCountries?.entities ?? []).filter(c => c.active > 0);
                    return active.length > 0 ? (
                      <span className="text-[10px] bg-blue-500/12 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20 font-semibold">{active.length} active</span>
                    ) : null;
                  })()}
                </div>
                <Link href="/bitseye2" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 whitespace-nowrap" data-testid="link-geography-explore">
                  Live Map <ExternalLink className="w-2.5 h-2.5" />
                </Link>
              </div>
              <div className="px-5 py-4">
                {(() => {
                  const active = (topCountries?.entities ?? []).filter(c => c.active > 0).sort((a, b) => b.active - a.active);
                  if (!topCountries) {
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {[100,80,120,90,70].map(w => (
                          <div key={w} className="h-6 rounded-lg bg-muted/30 animate-pulse" style={{ width: w }} />
                        ))}
                      </div>
                    );
                  }
                  if (active.length === 0) {
                    return (
                      <div className="py-4 text-center text-sm text-muted-foreground/40 flex items-center justify-center gap-2">
                        <Globe className="w-4 h-4" />
                        No active traffic routes
                      </div>
                    );
                  }
                  const max = active[0]?.active ?? 1;
                  return (
                    <div className="space-y-2">
                      {active.slice(0, 10).map(c => {
                        const pct = Math.round((c.active / max) * 100);
                        const crColor = c.connectRate >= 70 ? 'bg-emerald-500' : c.connectRate >= 40 ? 'bg-amber-500' : 'bg-red-500';
                        const crText = c.connectRate >= 70 ? 'text-emerald-400' : c.connectRate >= 40 ? 'text-amber-400' : 'text-red-400';
                        return (
                          <Link key={c.name} href="/bitseye2" className="flex items-center gap-3 group cursor-pointer" data-testid={`row-geo-country-${c.name}`}>
                            <span className="text-xs font-medium text-foreground/80 group-hover:text-foreground transition-colors w-24 shrink-0 truncate">{c.name}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                              <div className={`h-full rounded-full ${crColor} opacity-70 transition-all duration-500`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className={`text-[10px] font-semibold tabular-nums shrink-0 ${crText}`}>{c.active}</span>
                            <span className="text-[9px] text-muted-foreground/50 shrink-0 w-8 text-right">{c.connectRate}%</span>
                          </Link>
                        );
                      })}
                      {active.length > 10 && (
                        <Link href="/bitseye2" className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-1 block text-center">
                          +{active.length - 10} more countries →
                        </Link>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

        </div>
      </div>

      {/* ── Smart Priorities ─────────────────────────────────────────────────── */}
      {openIncidents.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.03] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-amber-500/15 bg-amber-500/[0.03]">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Smart Priorities
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {criticalCount + highCount > 0
                  ? `${criticalCount + highCount} item${criticalCount + highCount !== 1 ? 's' : ''} require${criticalCount + highCount === 1 ? 's' : ''} immediate attention`
                  : `${openIncidents.length} open incident${openIncidents.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <Link
              href="/console"
              className="flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors"
              data-testid="link-smart-priorities-view-all"
            >
              View All ({openIncidents.length})
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {openIncidents.slice(0, 3).map((inc: any) => (
              <Link
                key={inc.id}
                href={`/console`}
                data-testid={`card-priority-${inc.id}`}
              >
                <div className="group bg-card/60 border border-border/50 hover:border-amber-500/30 rounded-lg p-3.5 transition-all duration-200 cursor-pointer h-full">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wide ${SEVE_CLS[inc.severity] ?? SEVE_CLS.info}`}>
                      {inc.severity ?? 'info'}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </div>
                  <p className="text-sm font-medium leading-snug line-clamp-1">{inc.title || inc.entityName || 'Incident'}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{inc.description || `${inc.entityType || 'system'} · ${inc.entityName || '—'}`}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Primary Workflows ────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Primary Workflows</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Most important operational workflows</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PRIMARY_WORKFLOWS.map(wf => {
            const Icon = wf.icon;
            const isUrgent = wf.severity === 'critical' || wf.severity === 'high';
            return (
              <Link key={wf.id} href={wf.href} data-testid={`card-workflow-${wf.id}`}>
                <div className={`group bg-card border rounded-xl p-5 hover:shadow-md transition-all duration-200 cursor-pointer h-full flex flex-col ${isUrgent ? 'border-amber-500/20 hover:border-amber-500/40' : 'border-border/50 hover:border-border'}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 rounded-lg transition-colors ${isUrgent ? 'bg-amber-500/10 group-hover:bg-amber-500/15' : 'bg-muted/50 group-hover:bg-muted'}`}>
                      <Icon className={`w-4 h-4 ${isUrgent ? 'text-amber-400' : 'text-muted-foreground'}`} />
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sevBadge(wf.severity)}`}>
                      {sevLabel(wf.severity)}
                    </span>
                  </div>
                  <h4 className="font-semibold text-sm mb-1">{wf.label}</h4>
                  <p className="text-xs text-muted-foreground mb-4 leading-relaxed flex-1">{wf.desc}</p>
                  <div className="flex items-center gap-4 text-xs border-t border-border/40 pt-3">
                    <div>
                      <span className="font-bold text-foreground tabular-nums">{wf.stat1.value}</span>
                      <span className="text-muted-foreground ml-1">{wf.stat1.label}</span>
                    </div>
                    <div className="w-px h-3 bg-border/60" />
                    <div>
                      <span className="font-bold text-foreground tabular-nums">{wf.stat2.value}</span>
                      <span className="text-muted-foreground ml-1">{wf.stat2.label}</span>
                    </div>
                    <div className="ml-auto">
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Secondary Workflows ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Secondary Workflows</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Supporting operational tools</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {SECONDARY_WORKFLOWS.map(wf => {
            const Icon = wf.icon;
            return (
              <Link key={wf.id} href={wf.href} data-testid={`card-secondary-${wf.id}`}>
                <div className="group bg-card border border-border/50 rounded-xl p-4 hover:border-border hover:shadow-md transition-all duration-200 cursor-pointer h-full flex flex-col">
                  <div className="p-2 rounded-lg bg-muted/50 group-hover:bg-muted transition-colors w-fit mb-3">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <h4 className="font-semibold text-sm mb-1">{wf.label}</h4>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed flex-1">{wf.desc}</p>
                  <div className="flex items-center justify-between text-xs border-t border-border/40 pt-3">
                    <div>
                      <span className="font-bold text-foreground tabular-nums">{wf.stat.value}</span>
                      <span className="text-muted-foreground ml-1">{wf.stat.label}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── System Health ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <div className={`w-2 h-2 rounded-full ${systemHealthItems.every(i => i.ok) ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <h3 className="font-semibold text-sm">System Health</h3>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${systemHealthItems.every(i => i.ok) ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
              {systemHealthItems.every(i => i.ok) ? 'All Systems Operational' : 'Degraded'}
            </span>
          </div>
          <Link href="/server-monitoring" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
            Details <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-border/40">
          {systemHealthItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.label} href={item.href} data-testid={`health-${item.label.toLowerCase().replace(/\s/g,'-')}`}>
                <div className="px-4 py-4 flex flex-col gap-1.5 hover:bg-muted/20 transition-colors cursor-pointer group">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{item.label}</span>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${item.ok ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${item.ok ? 'text-emerald-400' : 'text-rose-400'}`} />
                    <span className={`text-base font-bold tabular-nums ${item.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{item.value}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70 truncate">{item.detail}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Live Operational Feed ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Live Operational Feed
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Real-time system events and alerts</p>
          </div>
          <Link
            href="/console"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            data-testid="link-live-feed-view-all"
          >
            View All <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {feedItems.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Activity className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No active events — system is operational</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {feedItems.map(item => {
              const minsAgo = Math.floor((Date.now() - item.ts) / 60000);
              const timeLabel = minsAgo < 1 ? '<1m ago' : minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`;
              return (
                <Link key={item.id} href={item.href} data-testid={`row-feed-${item.id}`}>
                  <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors group">
                    <div className="text-xs text-muted-foreground/60 w-16 shrink-0 tabular-nums">{timeLabel}</div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize shrink-0 ${SEVE_CLS[item.severity] ?? SEVE_CLS.info}`}>
                      {item.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.label}</p>
                      {item.detail && <p className="text-xs text-muted-foreground truncate mt-0.5">{item.detail}</p>}
                    </div>
                    <span className="text-[10px] text-muted-foreground/50 shrink-0 hidden sm:block">{item.module}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Quick Actions ─────────────────────────────────────────────────────── */}
      <div>
        <h3 className="font-semibold text-sm mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {QUICK_ACTIONS.map(qa => {
            const Icon = qa.icon;
            return (
              <Link key={qa.href} href={qa.href} data-testid={`btn-quick-${qa.label.toLowerCase().replace(/\s+/g, '-')}`}>
                <div className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-border/50 bg-card hover:border-border hover:bg-muted/20 transition-all duration-200 cursor-pointer text-center">
                  <div className="p-2 rounded-lg bg-muted/50 group-hover:bg-primary/10 transition-colors">
                    <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors leading-tight">{qa.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>



      {/* ── Risk Destinations ────────────────────────────────────────────────── */}
      {riskDests.length > 0 && (
        <div className="rounded-xl border border-rose-500/20 bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <h3 className="font-semibold text-sm">Risk Destinations</h3>
              <span className="text-[10px] text-muted-foreground">degradation · FAS risk · routing awareness</span>
            </div>
            <Link href="/bitseye2?dim=destination" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-border/40">
            {riskDests.map((dest, i) => {
              const asr = dest.connectRate;
              const asrColor = asr < 40 ? 'text-rose-400' : asr < 70 ? 'text-amber-400' : 'text-emerald-400';
              const barColor = asr < 40 ? '#F43F5E' : asr < 70 ? '#F59E0B' : '#10B981';
              const fasRisk = asr < 40 ? { label: 'Critical', cls: 'border-red-500/40 text-red-400 bg-red-500/10' } : asr < 60 ? { label: 'High', cls: 'border-amber-500/40 text-amber-400 bg-amber-500/10' } : { label: 'Medium', cls: 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10' };
              const instability = asr < 40 ? 'Degrading' : asr < 60 ? 'Unstable' : 'Fluctuating';
              return (
                <Link key={i} href={`/prefix-intelligence?prefix=${encodeURIComponent(dest.name)}`} data-testid={`row-risk-dest-${i}`}>
                  <div className="flex items-center gap-5 px-5 py-3.5 hover:bg-muted/25 transition-colors group cursor-pointer">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold group-hover:text-foreground transition-colors truncate">{dest.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{dest.active} active · {dest.connected} connected</p>
                    </div>
                    <div className="text-center w-32 hidden sm:block">
                      <p className="text-[10px] text-muted-foreground mb-1.5">Connect Rate</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${asr}%`, background: barColor }} />
                        </div>
                        <span className={`text-xs font-bold tabular-nums w-8 text-right ${asrColor}`}>{asr}%</span>
                      </div>
                    </div>
                    <div className="text-center w-20 hidden md:block">
                      <p className="text-[10px] text-muted-foreground mb-1">FAS Risk</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${fasRisk.cls}`}>{fasRisk.label}</span>
                    </div>
                    <div className="text-center w-24 hidden lg:block">
                      <p className="text-[10px] text-muted-foreground mb-1">Instability</p>
                      <span className={`text-xs font-semibold ${asr < 50 ? 'text-rose-400' : 'text-amber-400'}`}>{instability}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Call Detail Drawer ────────────────────────────────────────────────── */}
      <Sheet open={callDrawer.open} onOpenChange={(open) => setCallDrawer(d => ({ ...d, open }))}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-blue-400" />
              <SheetTitle>Call Drilldown</SheetTitle>
            </div>
            <SheetDescription>Live call diagnostics and routing context</SheetDescription>
          </SheetHeader>
          {callDrawer.call && (
            <div className="py-5 space-y-5">
              {/* Caller / Callee */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/30 border border-border/40 p-4">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Caller</p>
                  <p className="font-mono text-sm font-bold break-all">{callDrawer.call.caller || '—'}</p>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/40 p-4">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Callee</p>
                  <p className="font-mono text-sm font-bold break-all">{callDrawer.call.callee || '—'}</p>
                </div>
              </div>
              {/* Core fields */}
              <div className="rounded-xl border border-border/50 overflow-hidden">
                {[
                  { label: 'Client / Account', value: callDrawer.call.clientName || callDrawer.call.accountId || '—' },
                  { label: 'State', value: callDrawer.call.ccState || callDrawer.call.callStatus || '—' },
                  { label: 'Vendor', value: callDrawer.call.vendor || callDrawer.call.connectionName || '—' },
                  { label: 'Codec', value: callDrawer.call.codec || callDrawer.call.cld_codec || '—' },
                  { label: 'Setup Time', value: callDrawer.call.setupTime ? callDrawer.call.setupTime.replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3 ').replace(/\.\d+$/, '') : '—' },
                  { label: 'Call ID', value: callDrawer.call.callId || callDrawer.call.call_id || '—' },
                  { label: 'Source IP', value: callDrawer.call.srcIp || callDrawer.call.source_ip || '—' },
                  { label: 'Destination IP', value: callDrawer.call.dstIp || callDrawer.call.destination_ip || '—' },
                ].map(row => (
                  <div key={row.label} className="flex items-start gap-3 px-4 py-2.5 border-b border-border/40 last:border-0">
                    <span className="text-xs text-muted-foreground w-36 flex-shrink-0 pt-0.5">{row.label}</span>
                    <span className="text-xs font-medium break-all">{String(row.value)}</span>
                  </div>
                ))}
              </div>
              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Link href="/calls" onClick={() => setCallDrawer({ open: false, call: null })}>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/25 text-xs font-medium hover:bg-blue-500/20 transition-colors">
                    <PhoneCall className="w-3 h-3" /> Full Call Monitor
                  </button>
                </Link>
                <Link href="/fraud-engine" onClick={() => setCallDrawer({ open: false, call: null })}>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/25 text-xs font-medium hover:bg-rose-500/20 transition-colors">
                    <ShieldAlert className="w-3 h-3" /> FAS Analysis
                  </button>
                </Link>
                {callDrawer.call.clientName && (
                  <Link href={`/bitseye2?dim=client&entity=${encodeURIComponent(callDrawer.call.clientName)}`} onClick={() => setCallDrawer({ open: false, call: null })}>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/25 text-xs font-medium hover:bg-violet-500/20 transition-colors">
                      <BarChart2 className="w-3 h-3" /> Client Analytics
                    </button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Dashboard Customize Sheet ──────────────────────────────────────── */}
      <Sheet open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="w-4 h-4 text-indigo-400" />
              <SheetTitle>Customize Dashboard</SheetTitle>
            </div>
            <SheetDescription>
              Toggle sections on or off. Drag the grip handles on the KPI cards to reorder them.
            </SheetDescription>
          </SheetHeader>

          <div className="py-4 space-y-1">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-3">
              Dashboard Sections
            </p>
            {DASHBOARD_WIDGETS.map((w) => {
              const isVisible = !hiddenWidgets.has(w.id);
              return (
                <div
                  key={w.id}
                  className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-muted/30 transition-colors"
                  data-testid={`customize-widget-${w.id}`}
                >
                  <Switch
                    checked={isVisible}
                    onCheckedChange={() => toggleWidget(w.id)}
                    data-testid={`toggle-widget-${w.id}`}
                    className="mt-0.5 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug">{w.label}</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5 leading-snug">{w.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-border/40 pt-4 px-1">
            <div className="rounded-lg bg-muted/20 border border-border/40 p-3 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground/80 leading-relaxed">
                Drag KPI metric cards on the dashboard using the <span className="font-medium text-foreground/60">⠿</span> handle to change their order. Changes are saved automatically.
              </p>
            </div>
            <button
              className="mt-3 w-full text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors py-1"
              onClick={() => {
                savePrefsMutation.mutate({ hidden: [], order: DEFAULT_KPI_ORDER });
                setCustomizeOpen(false);
              }}
              data-testid="button-reset-dashboard"
            >
              Reset to defaults
            </button>
          </div>
        </SheetContent>
      </Sheet>

    </div>
  );
}
