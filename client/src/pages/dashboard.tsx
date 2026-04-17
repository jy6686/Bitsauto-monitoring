import { useState, useEffect, useMemo, useCallback } from "react";
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
import { MONITORING_ITEMS } from "@shared/schema";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { 
  ComposedChart,
  Area, 
  Bar,
  BarChart,
  Line,
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
  const normalized = setupTime.replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T');
  const t = new Date(normalized).getTime();
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
    refetchInterval: 120_000,
  });



  // Dashboard widget preferences
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const { data: widgetPrefs } = useQuery<{ hiddenWidgets: string[]; widgetOrder: string[] }>({
    queryKey: ['/api/user/dashboard-prefs'],
  });
  const hiddenWidgets = new Set(widgetPrefs?.hiddenWidgets ?? []);
  const showWidget = (id: string) => !hiddenWidgets.has(id);

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
    { id: 'live_metrics',       label: 'Live Metrics Cards',      description: 'Active Calls, MOS, ASR, ACD, Traffic Score, CPS' },
    { id: 'revenue_analytics',  label: 'Revenue & Margin Analytics', description: '30-day P&L summary, per-client and per-vendor breakdown' },
    { id: 'live_calls_table',   label: 'Live Calls Table',         description: 'Real-time active call list with quality metrics' },
    { id: 'asr_trend',          label: 'ASR/ACD Trend & Call Back Ratio', description: 'Historical ASR/ACD charts and FAS deduction graph' },
    { id: 'fas_events',         label: 'FAS Events & Stats',       description: 'False Answer Supervision detection log and summary' },
  ] as const;

  // Sippy session
  const { data: sippySession } = useQuery<{ active: boolean; username?: string; connectedAt?: string; portalUrl?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
  });
  // Sippy live calls — always polled; server uses hardcoded defaults so no session needed
  const { data: sippyLiveCalls } = useQuery<{ calls: any[]; connected?: boolean; error?: string }>({
    queryKey: ['/api/sippy/live-calls'],
    refetchInterval: 5000,
  });
  // Sippy real-time dashboard stats — ASR, ACD, PDD, active calls direct from Sippy switch
  const { data: sippyStats, isLoading: sippyStatsLoading, dataUpdatedAt: statsUpdatedAt } = useQuery<{
    asr: number; acd: number;
    connected: boolean;
    monOk?: boolean;          // true when CDR/monitoring API is reachable
    // CK stats from CDRs
    ckRatio?: number;
    ckBreakdown?: { connected: number; wrongNumber: number; switchedOff: number; untraceable: number; total: number };
    cdrCount?: number;
    // MOS estimate from E-model
    estimatedMos?: number | null;
    // CPS — from monitoring graph or CDR fallback
    cps?: number;
    cpsSource?: 'monitoring' | 'cdr';
  }>({
    queryKey: ['/api/sippy/dashboard-stats'],
    refetchInterval: 20000,
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
    refetchInterval: 120000,
    staleTime: 0,
    enabled: isSippyReachable,
  });

  const { data: fasEventsData } = useQuery<{ events: any[] }>({
    queryKey: ['/api/fas-events'],
    refetchInterval: 30000,
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
            {/* ASR */}
            <StatCard
              title="ASR"
              value={notConnected ? '—' : `${displayAsr.toFixed(1)}%`}
              icon={BarChart2}
              className={displayAsr >= 30 ? 'border-emerald-500/20' : displayAsr > 0 ? 'border-amber-500/20' : 'border-rose-500/20'}
              description={asrIsLiveEstimate ? 'Live connection rate (CDR API pending)' : 'Answer-Seizure Ratio'}
            />
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

  return (
    <div className="space-y-6">
      {/* ── Widget Customize Sheet ──────────────────────────────────────────── */}
      <Sheet open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <SheetContent side="right" className="w-80 sm:w-[420px] overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Customize Dashboard
            </SheetTitle>
            <SheetDescription>
              Toggle KPI widgets and sections. Drag cards on the dashboard to reorder.
            </SheetDescription>
          </SheetHeader>

          {/* ── KPI Widget Library ── */}
          <div className="mb-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">KPI Widgets</p>
            <div className="space-y-2">
              {KPI_WIDGET_DEFS.map(w => {
                const enabled = showWidget(w.id);
                return (
                  <div
                    key={w.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-all",
                      enabled ? "bg-muted/30 border-border/50" : "bg-muted/10 border-border/20 opacity-60"
                    )}
                    data-testid={`widget-library-card-${w.id}`}
                  >
                    <div className={cn("p-1.5 rounded-lg", enabled ? "bg-primary/10" : "bg-muted/30")}>
                      <w.icon className={cn("h-3.5 w-3.5", enabled ? "text-primary" : "text-muted-foreground/40")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{w.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{w.description}</p>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={() => toggleWidget(w.id)}
                      disabled={savePrefsMutation.isPending}
                      data-testid={`switch-widget-${w.id}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Dashboard Sections ── */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">Dashboard Sections</p>
            <div className="space-y-2">
              {DASHBOARD_WIDGETS.map(widget => (
                <div key={widget.id} className="flex items-start justify-between gap-4 p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{widget.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{widget.description}</p>
                  </div>
                  <Switch
                    checked={showWidget(widget.id)}
                    onCheckedChange={() => toggleWidget(widget.id)}
                    disabled={savePrefsMutation.isPending}
                    data-testid={`switch-widget-${widget.id}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {(hiddenWidgets.size > 0 || currentOrder.join(',') !== DEFAULT_KPI_ORDER.join(',')) && (
            <button
              onClick={() => savePrefsMutation.mutate({ hidden: [], order: [...DEFAULT_KPI_ORDER] })}
              disabled={savePrefsMutation.isPending}
              className="mt-6 w-full text-xs text-muted-foreground hover:text-foreground py-2 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
              data-testid="button-reset-widgets"
            >
              Reset to defaults (show all · default order)
            </button>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Network Operations Center</h2>
            {anyPortalActive && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Sippy Softswitch · iEnvironment=5 ·{' '}
            <span className="font-mono text-xs">
              {sippySession?.username
                ? sippySession.username
                : anyPortalActive
                  ? (sippySession?.mode === 'portal' ? 'portal session' : 'connected')
                  : 'not connected'}
            </span>
            {anyPortalActive && secsAgo < 60 && (
              <span className="ml-2 text-muted-foreground/60">· refreshed {secsAgo}s ago</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* ── NOC Clock ────────────────────────────────────────────────────── */}
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

            {/* Timezone picker dropdown */}
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

          {isAdmin && (
            <button
              onClick={() => setCustomizeOpen(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              data-testid="button-customize-dashboard"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Customize
              {hiddenWidgets.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold leading-none">
                  {hiddenWidgets.size} hidden
                </span>
              )}
            </button>
          )}
        </div>
        {/* Inline key metrics strip */}
        {anyPortalActive && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50">
              <Radio className="w-3 h-3 text-blue-400" />
              <span className="text-muted-foreground">Active:</span>
              <span className="font-bold text-blue-400">{displayActiveCalls}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50" title="Call attempts per minute — average over the last hour, computed from CDR records">
              <Zap className="w-3 h-3 text-violet-400" />
              <span className="text-muted-foreground">Call Rate:</span>
              <span className="font-bold text-violet-400">{callRatePerMin}/min</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50">
              <BarChart2 className="w-3 h-3 text-emerald-400" />
              <span className="text-muted-foreground">ASR:</span>
              <span className={`font-bold ${displayAsr >= 10 ? 'text-emerald-400' : displayAsr > 0 ? 'text-amber-400' : 'text-rose-400'}`}>{displayAsr.toFixed(1)}%</span>
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50`}>
              <Award className="w-3 h-3 text-amber-400" />
              <span className="text-muted-foreground">Score:</span>
              <span className={`font-bold ${scoreTextCls}`}>{trafficScore}/100</span>
            </div>
          </div>
        )}
      </div>

      {/* Connection required banner */}
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

      {/* CDR API unavailable warning — shown when portal is active but XML-RPC 401 */}
      {!notConnected && anyPortalActive && sippyStats?.monOk === false && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-200">XML-RPC API access not configured</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                CDR metrics, ASR trend, traffic charts, and call-back ratio require the XML-RPC API password.
                Enter it in Settings under <span className="font-medium text-foreground/70">API Password (XML-RPC key)</span>.
              </p>
            </div>
          </div>
          <Link href="/settings"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/80 text-white text-xs font-medium hover:bg-amber-500/80 transition-colors whitespace-nowrap flex-shrink-0"
            data-testid="link-settings-cdr-fix"
          >
            <Settings className="w-3 h-3" />
            Open Settings
          </Link>
        </div>
      )}

      {/* ── Draggable KPI Widget Grid ────────────────────────────────────────── */}
      {(() => {
        const visibleKpiWidgets = currentOrder.filter(id => !hiddenWidgets.has(id));
        if (visibleKpiWidgets.length === 0) return null;
        return (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={currentOrder} strategy={rectSortingStrategy}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="kpi-widget-grid">
                {visibleKpiWidgets.map(id => (
                  <SortableWidgetShell key={id} id={id}>
                    <KpiWidgetRenderer id={id} />
                  </SortableWidgetShell>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        );
      })()}

      {showWidget('live_metrics') && (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Active Calls + call rate badge */}
        <div className={cn(
          "bg-card border border-blue-500/20 rounded-xl p-5 shadow-lg shadow-black/5 hover:border-blue-500/40 transition-all duration-300 relative overflow-hidden group"
        )}>
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-500">
            <PhoneCall className="w-24 h-24" />
          </div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <h3 className="text-sm font-medium text-muted-foreground">Active Calls</h3>
            <div className="p-2 bg-secondary/50 rounded-lg group-hover:bg-blue-500/10 transition-colors">
              <PhoneCall className="w-4 h-4 text-foreground group-hover:text-blue-400" />
            </div>
          </div>
          <div className="relative z-10">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight tabular-nums">
                {notConnected ? '—' : displayActiveCalls}
              </span>
              {anyPortalActive && callRatePerMin > 0 && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-violet-400/10 text-violet-400 cursor-help" title={`Call rate: ${callRatePerMin} calls per minute — 1-hour CDR average`}>
                  {callRatePerMin}/min
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {anyPortalActive ? "Live concurrent calls on Sippy" : "Currently connected sessions"}
            </p>
          </div>
        </div>

        {/* Average MOS */}
        <StatCard 
          title="Avg MOS"
          value={notConnected ? '—' : displayMos != null ? `${displayMos.toFixed(2)}` : '—'}
          icon={Activity}
          className={displayMos != null && displayMos > 4 ? "border-emerald-500/20" : "border-amber-500/20"}
          description={anyPortalActive && mosLabel ? "E-model estimate · Sippy" : "Mean Opinion Score (5.0 scale)"}
          trend={anyPortalActive && displayMos != null ? {
            value: Math.round((displayMos / 5 - 0.8) * 100),
            isPositive: displayMos >= 4
          } : undefined}
        />

        {/* Traffic Quality Score */}
        <div className={cn(
          "bg-card border rounded-xl p-5 shadow-lg shadow-black/5 hover:border-opacity-60 transition-all duration-300 relative overflow-hidden group",
          scoreBorder
        )}>
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-500">
            <Award className="w-24 h-24" />
          </div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <h3 className="text-sm font-medium text-muted-foreground">Traffic Score</h3>
            <div className="p-2 bg-secondary/50 rounded-lg group-hover:bg-amber-500/10 transition-colors">
              <Award className="w-4 h-4 text-foreground group-hover:text-amber-400" />
            </div>
          </div>
          <div className="relative z-10">
            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-bold tracking-tight tabular-nums", notConnected ? 'text-muted-foreground/40' : scoreTextCls)}>
                {notConnected ? '—' : trafficScore}
              </span>
              {!notConnected && <span className="text-sm text-muted-foreground">/100</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {notConnected ? 'Connect to see quality score' : `${scoreLabel} · ASR+MOS+CK composite`}
            </p>
          </div>
          {/* Score bar */}
          {!notConnected && (
            <div className="mt-3 h-1 rounded-full bg-muted/40 overflow-hidden relative z-10">
              <div
                className={cn("h-full rounded-full transition-all duration-700",
                  trafficScore >= 80 ? 'bg-emerald-500' : trafficScore >= 60 ? 'bg-blue-500' : trafficScore >= 40 ? 'bg-amber-500' : 'bg-rose-500'
                )}
                style={{ width: `${trafficScore}%` }}
              />
            </div>
          )}
        </div>

        {/* Live CPS */}
        {(() => {
          const cps = anyPortalActive ? (sippyStats?.cps ?? 0) : 0;
          const cpsSource = sippyStats?.cpsSource ?? 'cdr';
          const cpsColor = cps === 0
            ? 'text-muted-foreground/50'
            : cps < 1 ? 'text-blue-400'
            : cps < 10 ? 'text-emerald-400'
            : cps < 30 ? 'text-amber-400'
            : 'text-rose-400';
          const cpsBorder = cps === 0
            ? 'border-border/50'
            : cps < 1 ? 'border-blue-500/20'
            : cps < 10 ? 'border-emerald-500/20'
            : cps < 30 ? 'border-amber-500/20'
            : 'border-rose-500/30';
          const srcLabel = cpsSource === 'monitoring' ? '5-min avg · Sippy monitor' : '1-hr avg · CDR estimate';
          const cpsLabel = cps === 0 ? 'No CDR data yet'
            : cps < 1 ? `Low traffic · ${srcLabel}`
            : cps < 10 ? `Normal load · ${srcLabel}`
            : cps < 30 ? `Moderate load · ${srcLabel}`
            : `High load · ${srcLabel}`;
          return (
            <div className={`bg-card border ${cpsBorder} rounded-xl p-5 shadow-lg shadow-black/5 hover:border-opacity-60 transition-all duration-300 relative overflow-hidden group`} title="Calls Per Second — how many new calls are being attempted per second">
              <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-500">
                <Zap className="w-24 h-24" />
              </div>
              <div className="flex items-center justify-between mb-3 relative z-10">
                <h3 className="text-sm font-medium text-muted-foreground">Calls/sec (CPS)</h3>
                <div className="p-2 bg-secondary/50 rounded-lg group-hover:bg-amber-500/10 transition-colors">
                  <Zap className={`w-4 h-4 ${cps > 0 ? cpsColor : 'text-foreground'} group-hover:text-amber-400`} />
                </div>
              </div>
              <div className="relative z-10">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-3xl font-bold tracking-tight tabular-nums ${notConnected ? 'text-muted-foreground/40' : cpsColor}`}>
                    {notConnected ? '—' : (sippyStatsLoading && !sippyStats) ? '…' : cps > 0 ? cps.toFixed(2) : '0.00'}
                  </span>
                  {!notConnected && <span className="text-sm text-muted-foreground">/s</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{notConnected ? 'Connect to see CPS' : cpsLabel}</p>
              </div>
              {!notConnected && cps > 0 && (
                <div className="mt-3 h-1 rounded-full bg-muted/40 overflow-hidden relative z-10">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${cps < 1 ? 'bg-blue-500' : cps < 10 ? 'bg-emerald-500' : cps < 30 ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ width: `${Math.min(100, (cps / 2) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })()}

      </div>
      )}


      {/* ── Revenue & Margin Analytics ───────────────────────────────────────── */}
      {showWidget('revenue_analytics') && anyPortalActive && (
        <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/40 bg-muted/10">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue &amp; Margin Analytics</span>
              {role !== 'admin' && myAccountsData?.kamName && (
                <span className="text-[10px] text-muted-foreground/60 normal-case ml-1">— {myAccountsData.kamName}'s clients</span>
              )}
            </div>
            <button
              onClick={() => refetchAnalytics()}
              disabled={analyticsRefetching}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors px-2 py-1 rounded hover:bg-muted/30 disabled:opacity-50"
              data-testid="button-refresh-analytics-dash"
            >
              <RefreshCw className={`w-3 h-3 ${analyticsRefetching ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{analyticsRefetching ? 'Refreshing…' : 'Refresh'}</span>
            </button>
          </div>

          {/* Admin: 4 summary cards */}
          {role === 'admin' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/40">
              {/* Total Revenue */}
              <div className="px-5 py-4 text-center bg-emerald-500/5">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Revenue</p>
                </div>
                <p className="text-2xl font-bold tabular-nums text-emerald-400" data-testid="analytics-revenue">
                  {analyticsData?.summary ? `$${analyticsData.summary.totalRevenue.toFixed(2)}` : '…'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Last 30 days</p>
              </div>
              {/* Total Cost */}
              <div className="px-5 py-4 text-center bg-rose-500/5">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Cost</p>
                </div>
                <p className="text-2xl font-bold tabular-nums text-rose-400" data-testid="analytics-cost">
                  {analyticsData?.summary ? `$${analyticsData.summary.totalCost.toFixed(2)}` : '…'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Vendor interconnect</p>
              </div>
              {/* Gross Profit */}
              <div className="px-5 py-4 text-center bg-blue-500/5">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Zap className="w-3.5 h-3.5 text-blue-400" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Gross Profit</p>
                </div>
                <p className={`text-2xl font-bold tabular-nums ${(analyticsData?.summary?.totalProfit ?? 0) >= 0 ? 'text-blue-400' : 'text-rose-400'}`} data-testid="analytics-profit">
                  {analyticsData?.summary ? `$${analyticsData.summary.totalProfit.toFixed(2)}` : '…'}
                </p>
              </div>
              {/* Margin % */}
              <div className="px-5 py-4 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Margin</p>
                </div>
                <p className={`text-2xl font-bold tabular-nums ${(analyticsData?.summary?.margin ?? 0) >= 15 ? 'text-emerald-400' : (analyticsData?.summary?.margin ?? 0) >= 5 ? 'text-amber-400' : 'text-rose-400'}`} data-testid="analytics-margin">
                  {analyticsData?.summary ? `${analyticsData.summary.margin.toFixed(1)}%` : '…'}
                </p>
              </div>
            </div>
          )}

          {/* Management / Viewer (KAM): Revenue only, filtered to assigned clients */}
          {role !== 'admin' && (
            <div className="px-5 py-4">
              {kamAnalytics ? (
                <div className="space-y-3">
                  {/* Revenue total */}
                  <div className="flex items-center gap-3">
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-5 py-3 flex items-center gap-3">
                      <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Your Clients Revenue</p>
                        <p className="text-2xl font-bold text-emerald-400 tabular-nums" data-testid="analytics-kam-revenue">
                          ${kamAnalytics.totalRevenue.toFixed(2)}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Last 30 days · {kamAnalytics.clients.length} client{kamAnalytics.clients.length !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                  </div>
                  {/* Per-client revenue breakdown */}
                  <div className="flex flex-wrap gap-2">
                    {kamAnalytics.clients.map(c => (
                      <div key={c.name} className="bg-card border border-border/50 rounded-lg px-3 py-2 text-center min-w-[100px]">
                        <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{c.name}</p>
                        <p className="text-sm font-bold text-emerald-400 tabular-nums">${c.revenue.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : analyticsData ? (
                <div className="text-center text-muted-foreground text-sm py-3">
                  <DollarSign className="w-5 h-5 mx-auto mb-1.5 opacity-30" />
                  No revenue data for your assigned clients in the last 30 days
                </div>
              ) : (
                <div className="text-center text-muted-foreground text-sm py-3">Loading analytics…</div>
              )}
            </div>
          )}
        </div>
      )}


      {/* Active Calls Table — Sippy live when connected, local DB otherwise */}
      {showWidget('live_calls_table') && <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/50 flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-blue-500" />
            {anyPortalActive ? `Live Calls on Sippy (${liveCalls.length})` : 'Recent Active Calls'}
          </h3>
          <Link href="/calls" className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80 transition-colors">
            View All Calls <ArrowRight className="ml-1 w-4 h-4" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          {anyPortalActive ? (
            liveCalls.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">No active calls on Sippy right now.</div>
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
                  {liveCalls.slice(0, 20).map((call: any, i: number) => (
                    <LiveCallRow key={call.callId || i} call={call} index={i} />
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium">
                <tr>
                  <th className="px-6 py-3">Caller</th>
                  <th className="px-6 py-3">Callee</th>
                  <th className="px-6 py-3">Started</th>
                  <th className="px-6 py-3">MOS Score</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {recentCalls?.map((call) => {
                  const calleeCountry = lookupCountry(call.callee);
                  return (
                    <tr key={call.id} className="hover:bg-muted/30 transition-colors group">
                      <td className="px-6 py-4 font-mono text-xs">
                        <span className="flex items-center gap-1.5 group/caller">
                          {call.caller}
                          {call.caller && call.callee && (
                            <Link
                              href={`/test-call?cli=${encodeURIComponent(call.caller)}&cld=${encodeURIComponent(call.callee)}`}
                              data-testid={`link-testcall-caller-${call.id}`}
                              title="Launch test call"
                              className="text-primary/40 hover:text-primary transition-colors opacity-0 group-hover/caller:opacity-100"
                            >
                              <PhoneCall className="h-3 w-3" />
                            </Link>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-1.5 group/callee">
                        <span className="font-mono text-xs">{call.callee}</span>
                        {call.caller && call.callee && (
                          <Link
                            href={`/test-call?cli=${encodeURIComponent(call.caller)}&cld=${encodeURIComponent(call.callee)}`}
                            data-testid={`link-testcall-callee-${call.id}`}
                            title="Launch test call"
                            className="text-primary/40 hover:text-primary transition-colors opacity-0 group-hover/callee:opacity-100"
                          >
                            <PhoneCall className="h-3 w-3" />
                          </Link>
                        )}
                        </span>
                        {calleeCountry && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {calleeCountry.flag} {calleeCountry.name}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {call.startTime ? formatUTC(new Date(call.startTime), 'HH:mm:ss') : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <MosBadge value={call.latestMetric?.mos || 0} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link href={`/calls/${call.id}`} className="text-primary hover:underline opacity-0 group-hover:opacity-100 transition-opacity">
                          Details
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>}

      {/* ── Graphs Row: ASR/ACD Trend + Call Back Ratio ─────────────────────── */}
      {showWidget('asr_trend') && <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ASR & ACD Trend */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                ASR &amp; ACD Trend
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Answer-Seizure Ratio (%) + Avg Call Duration (s)</p>
            </div>
            <div className="flex items-center gap-2">
              {chartData.length > 0 && (
                <div className="hidden sm:flex items-center gap-3 text-xs mr-2">
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 rounded-full inline-block" /> ASR</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-400 rounded-full inline-block" style={{borderTop: '2px dashed #a78bfa'}} /> ACD</span>
                </div>
              )}
              <select
                className="bg-background border border-border rounded-md text-xs px-2 py-1"
                value={trendHours}
                onChange={e => setTrendHours(Number(e.target.value))}
                data-testid="select-trend-window"
              >
                <option value={1}>Last 1h</option>
                <option value={6}>Last 6h</option>
                <option value={24}>Last 24h</option>
              </select>
            </div>
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
                {!notConnected && (
                  <p className="text-xs text-muted-foreground/60 text-center max-w-xs">
                    Set the correct API Password in Settings to enable historical trend charts.
                  </p>
                )}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 6, right: 40, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAsrG" x1="0" y1="0" x2="0" y2="1">
                      <BseGradStops color="#10b981" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...BSE_GRID_PROPS} />
                  <XAxis dataKey="time" {...BSE_AXIS_PROPS} interval="preserveStartEnd" />
                  <YAxis yAxisId="asr" orientation="left" {...BSE_AXIS_PROPS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={36} />
                  <YAxis yAxisId="acd" orientation="right" {...BSE_AXIS_PROPS} tickFormatter={(v) => `${v}s`} width={36} />
                  <Tooltip content={<BseTooltip formatter={(v, key) => key === 'asr' ? [`${v}%`, 'ASR'] : [`${v}s`, 'ACD']} />} cursor={BSE_CURSOR} />
                  <Area yAxisId="asr" type="monotone" dataKey="asr" stroke="#10b981" strokeWidth={2.5} fill="url(#colorAsrG)" dot={false} activeDot={bseActiveDot('#10b981')} strokeLinejoin="round" strokeLinecap="round" />
                  <Line yAxisId="acd" type="monotone" dataKey="acd" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={bseActiveDot('#a78bfa', 3)} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Call Back Ratio — FAS Deduction */}
        <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4 border-b border-border/50">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm tracking-wide uppercase text-muted-foreground">Call Back Ratio</h3>
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                FAS Deduction
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70">
              Calls answered by the actual user ÷ total call attempts · Failed calls (wrong number, switched off, untraceable) are deducted
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span
              data-testid="text-ck-ratio"
              className={`text-4xl font-bold font-mono tabular-nums ${
                notConnected ? 'text-muted-foreground/40' :
                displayCkRatio >= 80 ? 'text-emerald-400' :
                displayCkRatio >= 60 ? 'text-amber-400' : 'text-rose-400'
              }`}
            >
              {notConnected ? '—' : `${displayCkRatio.toFixed(1)}%`}
            </span>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {anyPortalActive && sippyStats?.ckBreakdown != null ? 'last 2 hr · sippy cdrs' : 'connection rate today'}
            </span>
          </div>
        </div>

        {notConnected ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
            <Globe className="w-4 h-4" />
            Connect to your softswitch to see call breakdown data
          </div>
        ) : (
        <>{/* Breakdown columns */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/50">
          {/* Connected */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Connected</span>
            <span data-testid="text-ck-connected" className="text-2xl font-bold text-emerald-400 tabular-nums">
              {(displayCkBreakdown?.connected ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">Answered by user</span>
          </div>
          {/* Wrong Number */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <PhoneMissed className="w-5 h-5 text-rose-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Wrong Number</span>
            <span data-testid="text-ck-wrong" className="text-2xl font-bold text-rose-400 tabular-nums">
              {(displayCkBreakdown?.wrongNumber ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">Invalid / misrouted</span>
          </div>
          {/* Switched Off */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <PhoneOff className="w-5 h-5 text-orange-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Switched Off</span>
            <span data-testid="text-ck-off" className="text-2xl font-bold text-orange-400 tabular-nums">
              {(displayCkBreakdown?.switchedOff ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">Device unreachable</span>
          </div>
          {/* Untraceable */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <Signal className="w-5 h-5 text-amber-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Untraceable</span>
            <span data-testid="text-ck-untraceable" className="text-2xl font-bold text-amber-400 tabular-nums">
              {(displayCkBreakdown?.untraceable ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">No network / signal</span>
          </div>
        </div>

        {/* Progress bar + legend */}
        {(displayCkBreakdown?.total ?? 0) > 0 && (
          <div className="px-6 pb-5 pt-2 space-y-2">
            <div className="h-2.5 rounded-full overflow-hidden bg-muted/30 flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{ width: `${(displayCkBreakdown?.connected ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }}
              />
              <div
                className="bg-rose-500 h-full transition-all duration-500"
                style={{ width: `${(displayCkBreakdown?.wrongNumber ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }}
              />
              <div
                className="bg-orange-500 h-full transition-all duration-500"
                style={{ width: `${(displayCkBreakdown?.switchedOff ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }}
              />
              <div
                className="bg-amber-500 h-full transition-all duration-500"
                style={{ width: `${(displayCkBreakdown?.untraceable ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground/60">
              <span>
                <span className="text-muted-foreground font-medium">{(displayCkBreakdown?.total ?? 0).toLocaleString()}</span>
                {' '}{anyPortalActive && sippyStats?.ckBreakdown != null ? 'calls last hour (Sippy CDRs)' : 'total attempts today'}
              </span>
              <span>
                Failed: <span className="text-rose-400 font-medium">
                  {((displayCkBreakdown?.total ?? 0) - (displayCkBreakdown?.connected ?? 0)).toLocaleString()}
                </span>
              </span>
            </div>
          </div>
        )}
        </>
        )}
      </div>

      </div>}{/* ── end Graphs Row grid ─── */}

      {/* ── FAS Events + Stats ───────────────────────────────────────────────── */}
      {showWidget('fas_events') && fasAll.length > 0 && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-rose-500/15">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <h3 className="font-semibold text-sm text-rose-300">FAS Detections</h3>
            <span className="ml-1 text-xs text-rose-400/70">— False Answer Supervision analysis</span>
            <Link href="/fraud" className="ml-auto text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {/* Stats + Chart row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-rose-500/15">
            {/* Stat chips */}
            <div className="grid grid-cols-2 divide-x divide-y divide-rose-500/10">
              {[
                { label: 'Zero Billed',  count: fasZeroBilled,  cls: 'text-red-400',    bg: 'bg-red-500/10'    },
                { label: 'High PDD',     count: fasHighPdd,     cls: 'text-orange-400', bg: 'bg-orange-500/10' },
                { label: 'Short Billed', count: fasShortBilled, cls: 'text-violet-400', bg: 'bg-violet-500/10' },
                { label: 'Early Answer', count: fasEarlyAnswer, cls: 'text-yellow-400', bg: 'bg-yellow-500/10' },
              ].map(s => (
                <div key={s.label} className={`flex flex-col items-center justify-center py-5 px-3 ${s.bg}`}>
                  <span className={`text-2xl font-bold tabular-nums ${s.cls}`}>{s.count}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 text-center">{s.label}</span>
                </div>
              ))}
            </div>
            {/* Bar chart */}
            <div className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Reason Breakdown</p>
              <div className="h-[140px]">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={fasBarData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid {...BSE_GRID_PROPS} />
                    <XAxis dataKey="name" {...BSE_AXIS_PROPS} />
                    <YAxis {...BSE_AXIS_PROPS} allowDecimals={false} />
                    <Tooltip content={<BseTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {fasBarData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Events feed */}
          <div className="divide-y divide-rose-500/10 border-t border-rose-500/15">
            {recentFasEvents.map((ev: any) => {
              const reasons: string[] = (ev.reason ?? '').split(',').map((r: string) => r.trim()).filter(Boolean);
              return (
                <div key={ev.id} className="flex items-center gap-4 px-5 py-2.5 text-xs hover:bg-rose-500/5">
                  <div className="flex-shrink-0 text-muted-foreground/60 w-28">
                    {formatUTC(new Date(ev.detectedAt), 'dd MMM HH:mm:ss')}
                  </div>
                  <div className="flex-shrink-0 min-w-[90px]">
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary/80 font-medium">
                      {ev.clientName || 'Unknown'}
                    </span>
                  </div>
                  <div className="flex-shrink-0">
                    {ev.vendor ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
                        <Server className="h-2.5 w-2.5" />{ev.vendor}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </div>
                  <div className="font-mono text-muted-foreground truncate">
                    {ev.caller ?? '—'} <span className="text-muted-foreground/40">→</span> {ev.callee ?? '—'}
                  </div>
                  <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    {reasons.map(r => (
                      <span key={r} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                        r === 'high_pdd'    ? 'bg-orange-500/15 text-orange-400' :
                        r === 'zero_billed' ? 'bg-red-500/15 text-red-400' :
                        r === 'short_billed'? 'bg-violet-500/15 text-violet-400' :
                        r === 'early_answer'? 'bg-yellow-500/15 text-yellow-400' :
                        'bg-muted/30 text-muted-foreground'
                      }`}>
                        {r.replace(/_/g, ' ')}
                      </span>
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
