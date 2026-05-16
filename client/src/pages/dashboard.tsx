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
  Plus,
  Check,
  LayoutGrid,
  Download,
  FileSpreadsheet,
  Info,
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
  const { data: sippyLiveCalls, refetch: refetchLiveCalls } = useQuery<{ calls: any[]; connected?: boolean; stale?: boolean; error?: string }>({
    queryKey: ['/api/sippy/live-calls'],
    staleTime: 30_000,
    refetchInterval: 60_000,
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
              {anyPortalActive && secsAgo < 60 && <span className="ml-2 text-muted-foreground/60">· refreshed {secsAgo}s ago</span>}
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

  return (
    <div className="space-y-5">

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight">Network Operations Center</h2>
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
            {anyPortalActive && secsAgo < 60 && (
              <span className="ml-2 text-muted-foreground/60">· refreshed {secsAgo}s ago</span>
            )}
          </p>
        </div>

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

      {/* ── Banners ─────────────────────────────────────────────────────────── */}
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

      {/* ── Hero Row: Active Calls | Network Health | System State ────────── */}
      <div className="grid gap-4 sm:grid-cols-3">

        {/* Active Calls */}
        <div className="bg-card border border-blue-500/20 rounded-xl p-6 shadow-lg relative overflow-hidden group hover:border-blue-500/40 transition-all duration-300"
          data-testid="card-active-calls">
          <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity duration-500">
            <PhoneCall className="w-28 h-28" />
          </div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Calls</span>
            <div className="flex items-center gap-2">
              {anyPortalActive && !liveCallsStale && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  LIVE
                </span>
              )}
              {liveCallsStale && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                  ~cached
                </span>
              )}
              <div className="p-2 bg-secondary/50 rounded-lg group-hover:bg-blue-500/10 transition-colors">
                <PhoneCall className="w-4 h-4 text-blue-400" />
              </div>
            </div>
          </div>
          <div className="relative z-10">
            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-bold tracking-tight tabular-nums" data-testid="text-active-calls-count">
                {notConnected ? '—' : displayActiveCalls}
              </span>
              {anyPortalActive && callRatePerMin > 0 && !liveCallsStale && (
                <span className="text-sm font-medium px-2 py-0.5 rounded-full bg-violet-400/10 text-violet-400">
                  {callRatePerMin}/min
                </span>
              )}
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span><span className="text-emerald-400 font-semibold" data-testid="text-connected-count">{liveConnected}</span> connected</span>
              <span><span className="text-amber-400 font-semibold" data-testid="text-routing-count">{liveTotal - liveConnected}</span> routing</span>
            </div>
          </div>
        </div>

        {/* Network Health Score */}
        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg relative overflow-hidden group hover:border-border transition-all duration-300 flex flex-col items-center"
          data-testid="card-health-score">
          <div className="flex items-center justify-between w-full mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Network Health</span>
            <div className="p-2 bg-secondary/50 rounded-lg">
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <NetworkHealthGauge score={anyPortalActive ? trafficScore : 0} />
          <div className={`text-sm font-semibold mt-0.5 ${anyPortalActive ? scoreTextCls : 'text-muted-foreground/30'}`}>
            {anyPortalActive ? scoreLabel : '—'}
          </div>
          <div className="text-[10px] text-muted-foreground/50 mt-1 text-center">ASR 45% · MOS 30% · CK 15% · PDD 10%</div>
        </div>

        {/* System State */}
        <div className={`bg-card border rounded-xl p-6 shadow-lg relative overflow-hidden group transition-all duration-300 ${stateCardBorderCls}`}
          data-testid="card-system-state">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System State</span>
            <div className="p-2 bg-secondary/50 rounded-lg">
              <ShieldAlert className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
          <div className={`text-3xl font-bold tracking-tight ${stateValueCls}`} data-testid="text-system-state-label">
            {anyPortalActive ? systemState : '—'}
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Open incidents</span>
              <span className={`font-bold tabular-nums ${openIncidents.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}
                data-testid="text-open-incident-count">
                {openIncidents.length}
              </span>
            </div>
            {criticalCount > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Critical</span>
                <span className="font-bold text-rose-400" data-testid="text-critical-count">{criticalCount}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Traffic score</span>
              <span className={`font-bold tabular-nums ${anyPortalActive ? scoreTextCls : 'text-muted-foreground/30'}`}>
                {anyPortalActive ? `${trafficScore} / 100` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Call rate</span>
              <span className="font-bold text-violet-400 tabular-nums">
                {anyPortalActive && callRatePerMin > 0 ? `${callRatePerMin}/min` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI Strip: ASR / MOS / PDD / ACD / NER / CPS ─────────────────── */}
      <div className="grid gap-2 grid-cols-3 sm:grid-cols-6">
        {[
          {
            label: 'ASR',
            value: notConnected ? '—' : `${displayAsr.toFixed(1)}%`,
            note: asrIsLiveEstimate ? 'live est.' : '',
            good: displayAsr >= 50, warn: displayAsr >= 25,
            testid: 'kpi-asr',
          },
          {
            label: 'MOS',
            value: notConnected || displayMos == null ? '—' : displayMos.toFixed(2),
            note: mosLabel,
            good: (displayMos ?? 0) >= 3.5, warn: (displayMos ?? 0) >= 2.5,
            testid: 'kpi-mos',
          },
          {
            label: 'PDD',
            value: notConnected ? '—' : displayPdd > 0 ? `${displayPdd.toFixed(2)}s` : '—',
            note: '',
            good: displayPdd > 0 && displayPdd <= 2, warn: displayPdd > 0 && displayPdd <= 4,
            testid: 'kpi-pdd',
          },
          {
            label: 'ACD',
            value: notConnected ? '—' : displayAcd > 0 ? `${displayAcd.toFixed(0)}s` : '—',
            note: '',
            good: displayAcd >= 60, warn: displayAcd >= 20,
            testid: 'kpi-acd',
          },
          {
            label: 'NER',
            value: notConnected || displayNer == null ? '—' : `${displayNer.toFixed(1)}%`,
            note: '',
            good: (displayNer ?? 0) >= 90, warn: (displayNer ?? 0) >= 75,
            testid: 'kpi-ner',
          },
          {
            label: 'CPS',
            value: notConnected ? '—' : displayCps > 0 ? displayCps.toFixed(2) : '—',
            note: sippyStats?.cpsSource === 'cdr' ? 'est.' : '',
            good: true, warn: true,
            testid: 'kpi-cps',
          },
        ].map(kpi => (
          <div key={kpi.label}
            className="bg-card border border-border/40 rounded-xl px-4 py-3 flex flex-col gap-1 hover:border-border/70 transition-colors"
            data-testid={kpi.testid}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{kpi.label}</span>
              {kpi.note && <span className="text-[9px] text-muted-foreground/50">{kpi.note}</span>}
            </div>
            <span className={`text-xl font-bold tabular-nums ${
              kpi.value === '—' ? 'text-muted-foreground/30'
              : kpi.good ? 'text-emerald-400'
              : kpi.warn ? 'text-amber-400'
              : 'text-rose-400'
            }`}>
              {kpi.value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Active Incidents Strip ─────────────────────────────────────────── */}
      {openIncidents.length > 0 ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 overflow-hidden" data-testid="panel-incidents">
          <div className="flex items-center justify-between px-5 py-3 border-b border-rose-500/15">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <h3 className="font-semibold text-sm text-rose-300">Active Incidents</h3>
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 text-[10px] font-bold">
                {openIncidents.length}
              </span>
            </div>
            <Link href="/ai-ops" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              data-testid="link-ai-ops-view-all">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-rose-500/10 max-h-64 overflow-y-auto">
            {openIncidents.slice(0, 8).map((inc: any, i: number) => {
              const sev = inc.severity ?? 'medium';
              const sevCls = sev === 'critical'
                ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                : sev === 'high'
                ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                : sev === 'medium'
                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                : 'bg-blue-500/15 text-blue-400 border-blue-500/30';
              const ageMs = inc.createdAt ? Date.now() - new Date(inc.createdAt).getTime() : 0;
              const ageMin = Math.floor(ageMs / 60000);
              const age = ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
              return (
                <div key={inc.id ?? i}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-rose-500/5 transition-colors"
                  data-testid={`row-incident-${i}`}>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border uppercase tracking-wide flex-shrink-0 ${sevCls}`}>
                    {sev}
                  </span>
                  <span className="text-sm text-foreground/90 flex-1 truncate">{inc.title ?? inc.type ?? 'Unnamed incident'}</span>
                  <span className="text-xs text-muted-foreground/60 flex-shrink-0 tabular-nums">{age}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : anyPortalActive ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 flex items-center gap-3"
          data-testid="panel-no-incidents">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-300">All systems operational</p>
            <p className="text-xs text-muted-foreground mt-0.5">No open incidents detected</p>
          </div>
          <Link href="/ai-ops"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 whitespace-nowrap"
            data-testid="link-ai-ops">
            AI Ops <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      ) : null}

      {/* ── What changed · last 15 min ───────────────────────────────────── */}
      {anyPortalActive && (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden" data-testid="panel-delta">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40 bg-muted/10">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" />
              <h3 className="font-semibold text-sm">What changed · last 15 min</h3>
              {deltaSnap && (
                <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                  vs {Math.max(0, Math.round((Date.now() - deltaSnap.ts) / 60000))}m ago
                </span>
              )}
            </div>
            {!deltaSnap && (
              <span className="text-[11px] text-muted-foreground/40 italic">Gathering baseline…</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {([
              {
                label: 'Active Calls',
                now: displayActiveCalls as number | null,
                prev: deltaSnap?.activeCalls ?? null,
                fmt: (v: number) => String(v),
                higherBetter: true,
                testid: 'delta-calls',
              },
              {
                label: 'ASR',
                now: displayAsr,
                prev: deltaSnap?.asr ?? null,
                fmt: (v: number) => `${v.toFixed(1)}%`,
                higherBetter: true,
                testid: 'delta-asr',
              },
              {
                label: 'MOS',
                now: displayMos,
                prev: deltaSnap?.mos ?? null,
                fmt: (v: number) => v.toFixed(2),
                higherBetter: true,
                testid: 'delta-mos',
              },
              {
                label: 'PDD',
                now: displayPdd > 0 ? displayPdd : null,
                prev: (deltaSnap?.pdd ?? 0) > 0 ? (deltaSnap?.pdd ?? null) : null,
                fmt: (v: number) => `${v.toFixed(2)}s`,
                higherBetter: false,
                testid: 'delta-pdd',
              },
              {
                label: 'ACD',
                now: displayAcd > 0 ? displayAcd : null,
                prev: (deltaSnap?.acd ?? 0) > 0 ? (deltaSnap?.acd ?? null) : null,
                fmt: (v: number) => `${v.toFixed(0)}s`,
                higherBetter: true,
                testid: 'delta-acd',
              },
              {
                label: 'NER',
                now: displayNer,
                prev: deltaSnap?.ner ?? null,
                fmt: (v: number) => `${v.toFixed(1)}%`,
                higherBetter: true,
                testid: 'delta-ner',
              },
            ] as const).map((item, idx) => {
              const hasData = item.now != null && item.prev != null;
              const diff = hasData ? (item.now as number) - (item.prev as number) : 0;
              const significant = Math.abs(diff) > 0.05;
              const improved = (item.higherBetter ? diff > 0 : diff < 0) && significant;
              const worsened = (item.higherBetter ? diff < 0 : diff > 0) && significant;
              const borderCls = idx < 5 ? 'border-r border-border/30' : '';
              return (
                <div key={item.label}
                  className={`px-4 py-4 flex flex-col gap-1.5 ${borderCls} ${idx >= 3 ? 'border-t border-border/30 lg:border-t-0' : ''} ${idx >= 2 && idx < 4 ? 'sm:border-t sm:border-border/30 lg:border-t-0' : ''}`}
                  data-testid={item.testid}>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{item.label}</span>
                  <span className="text-xl font-bold tabular-nums">
                    {item.now != null ? item.fmt(item.now as number) : '—'}
                  </span>
                  {hasData && significant ? (
                    <div className={`flex items-center gap-1 text-xs font-semibold ${
                      improved ? 'text-emerald-400' : worsened ? 'text-rose-400' : 'text-muted-foreground/50'
                    }`}>
                      {improved
                        ? <TrendingUp className="w-3 h-3" />
                        : worsened
                        ? <TrendingDown className="w-3 h-3" />
                        : <Minus className="w-3 h-3" />}
                      {diff > 0 ? '+' : ''}{item.fmt(Math.abs(diff))}
                    </div>
                  ) : hasData ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground/40">
                      <Minus className="w-3 h-3" />
                      No change
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground/30 italic">Waiting…</div>
                  )}
                  {item.prev != null && (
                    <div className="text-[10px] text-muted-foreground/35">
                      was {item.fmt(item.prev as number)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
