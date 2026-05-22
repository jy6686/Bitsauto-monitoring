import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  formatUTC, formatInTz, toTzDateInput, tzDateToUTC,
  subMinutesUTC, subHoursUTC, subDaysUTC, subWeeksUTC, subMonthsUTC,
  startOfDayUTC, endOfDayUTC, startOfWeekUTC, endOfWeekUTC,
  startOfMonthUTC, endOfMonthUTC,
} from "@/lib/date-utils";
import { useTimezone } from "@/context/timezone-context";
import {
  Download, RefreshCw, Filter, TrendingUp, TrendingDown, Minus,
  Calendar, Clock, Globe, Building2, PhoneCall, CheckCircle2, PhoneOff,
  AlertTriangle, Users, DollarSign, Flag, ArrowRight,
  PhoneForwarded, PhoneIncoming, Activity, BarChart2, Layers, Server,
  Percent, ArrowUpRight, ArrowDownRight, Wifi, Gauge, Zap, ShieldCheck,
  TriangleAlert, BadgeCheck, ChevronDown,
} from "lucide-react";
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RcTooltip,
  ResponsiveContainer, ReferenceLine, Legend, Area, Cell,
} from 'recharts';
import { BseTooltip, BSE_GRID_PROPS, BSE_AXIS_PROPS, BSE_CURSOR, bseActiveDot } from "@/components/bse-chart";
import { Link } from "wouter";
import type { AsrAcdReportRow, ClientProfile } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type ReportRow = AsrAcdReportRow & {
  clientName?: string;
  country?: string;
  // nerPct, fasRate, rnaCount inherited from AsrAcdReportRow
};

type ActiveTab = 'client' | 'vendor' | 'connection' | 'revenue';

const COUNTRY_TO_ISO: Record<string, string> = {
  "Afghanistan":"AF","Albania":"AL","Algeria":"DZ","Angola":"AO","Argentina":"AR",
  "Australia":"AU","Austria":"AT","Azerbaijan":"AZ","Bahrain":"BH","Bangladesh":"BD",
  "Belarus":"BY","Belgium":"BE","Bolivia":"BO","Bosnia":"BA","Brazil":"BR",
  "Bulgaria":"BG","Cambodia":"KH","Cameroon":"CM","Canada":"CA","Chile":"CL",
  "China":"CN","Colombia":"CO","Congo":"CG","Costa Rica":"CR","Croatia":"HR",
  "Cuba":"CU","Czech Republic":"CZ","Denmark":"DK","Dominican Republic":"DO",
  "Ecuador":"EC","Egypt":"EG","El Salvador":"SV","Ethiopia":"ET","Finland":"FI",
  "France":"FR","Georgia":"GE","Germany":"DE","Ghana":"GH","Greece":"GR",
  "Guatemala":"GT","Haiti":"HT","Honduras":"HN","Hong Kong":"HK","Hungary":"HU",
  "India":"IN","Indonesia":"ID","Iran":"IR","Iraq":"IQ","Ireland":"IE",
  "Israel":"IL","Italy":"IT","Ivory Coast":"CI","Jamaica":"JM","Japan":"JP",
  "Jordan":"JO","Kazakhstan":"KZ","Kenya":"KE","Kosovo":"XK","Kuwait":"KW",
  "Kyrgyzstan":"KG","Laos":"LA","Latvia":"LV","Lebanon":"LB","Libya":"LY",
  "Lithuania":"LT","Luxembourg":"LU","Macedonia":"MK","Madagascar":"MG",
  "Malaysia":"MY","Mali":"ML","Mexico":"MX","Moldova":"MD","Mongolia":"MN",
  "Morocco":"MA","Mozambique":"MZ","Myanmar":"MM","Nepal":"NP","Netherlands":"NL",
  "New Zealand":"NZ","Nicaragua":"NI","Niger":"NE","Nigeria":"NG","Norway":"NO",
  "Oman":"OM","Pakistan":"PK","Palestine":"PS","Panama":"PA","Paraguay":"PY",
  "Peru":"PE","Philippines":"PH","Poland":"PL","Portugal":"PT","Qatar":"QA",
  "Romania":"RO","Russia":"RU","Rwanda":"RW","Saudi Arabia":"SA","Senegal":"SN",
  "Serbia":"RS","Sierra Leone":"SL","Slovakia":"SK","Slovenia":"SI","Somalia":"SO",
  "South Africa":"ZA","South Korea":"KR","South Sudan":"SS","Spain":"ES",
  "Sri Lanka":"LK","Sudan":"SD","Sweden":"SE","Switzerland":"CH","Syria":"SY",
  "Taiwan":"TW","Tajikistan":"TJ","Tanzania":"TZ","Thailand":"TH","Togo":"TG",
  "Tunisia":"TN","Turkey":"TR","Turkmenistan":"TM","Uganda":"UG","Ukraine":"UA",
  "United Arab Emirates":"AE","United Kingdom":"GB","United States":"US",
  "Uruguay":"UY","Uzbekistan":"UZ","Venezuela":"VE","Vietnam":"VN","Yemen":"YE",
  "Zambia":"ZM","Zimbabwe":"ZW",
};

// ── Degradation Intelligence types ────────────────────────────────────────────
type DegradationAlert = {
  vendor: string;
  currentQ: number;
  previousQ: number | null;
  deltaQ: number;
  trend: 'degrading' | 'improving' | 'stable';
  severity: 'critical' | 'warning' | 'info' | 'ok';
  signals: string[];
  callCount: number;
  currentAsr: number;
  previousAsr: number | null;
  currentFas: number;
  currentPdd: number;
};
type DegradationResponse = {
  generatedAt: string;
  windowMinutes: number;
  totalVendors: number;
  cdrCount: number;
  alerts: DegradationAlert[];
};

// ── Route Recommendation Engine types ─────────────────────────────────────────
type RouteRecommendationType = 'INVESTIGATE' | 'FAS_ALERT' | 'REDUCE_PRIORITY' | 'MONITOR' | 'PROMOTE';
type RouteRecommendation = {
  vendor: string;
  type: RouteRecommendationType;
  urgency: 'immediate' | 'today' | 'monitor';
  priority: number;
  title: string;
  detail: string[];
  confidence: number;
  currentQ: number;
  deltaQ: number | null;
  callCount: number;
  asr: number;
  fas: number;
  rca: {
    signals: {
      prev: { asr: number|null; ner: number|null; fas: number|null; pdd: number|null; q: number|null };
      cur:  { asr: number; ner: number; fas: number; pdd: number; q: number };
    };
    ruleDescription: string;
    topDestinations: Array<{ cld: string; calls: number; asr: number; fas: number; q: number }>;
    signalContributions: Array<{ signal: string; weight: string; value: string; prev: string|null; status: 'critical'|'warning'|'ok' }>;
  };
};
type RouteRecommendationsResponse = {
  generatedAt: string;
  windowMinutes: number;
  totalVendors: number;
  cdrCount: number;
  recommendations: RouteRecommendation[];
};

function countryFlag(countryName?: string): string {
  if (!countryName) return '';
  const iso = COUNTRY_TO_ISO[countryName] ?? Object.entries(COUNTRY_TO_ISO)
    .find(([k]) => countryName.toLowerCase().includes(k.toLowerCase()))?.[1];
  if (!iso || iso.length !== 2) return '';
  return String.fromCodePoint(
    iso.charCodeAt(0) - 65 + 0x1F1E6,
    iso.charCodeAt(1) - 65 + 0x1F1E6,
  );
}

function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s <= 0) return "00:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function fmtMins(minutes: number): string {
  if (minutes >= 60) return `${Math.round(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  return `${Math.round(minutes)}m`;
}

function toInput(d: Date, tz: string): string { return toTzDateInput(d, tz); }

// ── Route Quality Score (0–100) ─────────────────────────────────────────────
// Composite carrier-grade signal: ASR + NER + FAS penalty + PDD penalty
// Used for vendor ranking, degradation badges, and route intelligence panel.
function computeQuality(row: ReportRow): number {
  if (row.totalCalls === 0) return 0;
  const asrScore  = Math.min(row.asr, 100) * 0.40;
  const ner       = row.nerPct ?? row.asr;
  const nerScore  = Math.min(ner, 100) * 0.30;
  const fas       = row.fasRate ?? 0;
  const fasScore  = Math.max(0, 100 - fas * 4) * 0.20;         // FAS ≥ 25% → 0 pts
  const pdd       = row.avgPdd;
  const pddScore  = (pdd <= 1 ? 100 : pdd <= 3 ? 85 : pdd <= 6 ? 65 : pdd <= 10 ? 40 : 20) * 0.10;
  return Math.round(asrScore + nerScore + fasScore + pddScore);
}
function qualityLabel(q: number): string {
  return q >= 70 ? 'Good' : q >= 50 ? 'Fair' : q >= 30 ? 'Poor' : 'Critical';
}
function qualityColor(q: number): string {
  return q >= 70 ? 'text-emerald-400' : q >= 50 ? 'text-amber-400' : q >= 30 ? 'text-orange-400' : 'text-rose-400';
}
function qualityBg(q: number): string {
  return q >= 70 ? 'bg-emerald-500/15 border-emerald-500/30' : q >= 50 ? 'bg-amber-500/15 border-amber-500/30' : q >= 30 ? 'bg-orange-500/15 border-orange-500/30' : 'bg-rose-500/15 border-rose-500/30';
}

const PRESET_GROUPS = [
  { label: "Quick", presets: [
    { label: "Last 15 min",  fn: () => [subMinutesUTC(new Date(), 15), new Date()] as [Date,Date] },
    { label: "Last 30 min",  fn: () => [subMinutesUTC(new Date(), 30), new Date()] as [Date,Date] },
    { label: "Last 1 hr",    fn: () => [subHoursUTC(new Date(), 1),   new Date()] as [Date,Date] },
    { label: "Last 3 hr",    fn: () => [subHoursUTC(new Date(), 3),   new Date()] as [Date,Date] },
    { label: "Last 6 hr",    fn: () => [subHoursUTC(new Date(), 6),   new Date()] as [Date,Date] },
    { label: "Last 12 hr",   fn: () => [subHoursUTC(new Date(), 12),  new Date()] as [Date,Date] },
    { label: "Last 24 hr",   fn: () => [subHoursUTC(new Date(), 24),  new Date()] as [Date,Date] },
  ]},
  { label: "Daily", presets: [
    { label: "Today",       fn: () => [startOfDayUTC(new Date()), new Date()] as [Date,Date] },
    { label: "Yesterday",   fn: () => [startOfDayUTC(subDaysUTC(new Date(), 1)), endOfDayUTC(subDaysUTC(new Date(), 1))] as [Date,Date] },
    { label: "Last 2 days", fn: () => [startOfDayUTC(subDaysUTC(new Date(), 1)), new Date()] as [Date,Date] },
    { label: "Last 7 days", fn: () => [startOfDayUTC(subDaysUTC(new Date(), 6)), new Date()] as [Date,Date] },
  ]},
  { label: "Weekly", presets: [
    { label: "This week",  fn: () => [startOfWeekUTC(new Date()), new Date()] as [Date,Date] },
    { label: "Last week",  fn: () => [startOfWeekUTC(subWeeksUTC(new Date(), 1)), endOfWeekUTC(subWeeksUTC(new Date(), 1))] as [Date,Date] },
  ]},
  { label: "Monthly", presets: [
    { label: "This month",  fn: () => [startOfMonthUTC(new Date()), new Date()] as [Date,Date] },
    { label: "Last month",  fn: () => [startOfMonthUTC(subMonthsUTC(new Date(), 1)), endOfMonthUTC(subMonthsUTC(new Date(), 1))] as [Date,Date] },
  ]},
];

function matchProfile(number: string, profiles: ClientProfile[], type: 'client' | 'vendor', ip?: string): ClientProfile | null {
  const candidates = profiles.filter(p => p.type === type);
  if (ip) {
    const ipMatch = candidates.find(p => (p as any).ipAddress && (p as any).ipAddress === ip);
    if (ipMatch) return ipMatch;
  }
  let best: ClientProfile | null = null;
  let bestLen = 0;
  for (const p of candidates) {
    if (p.prefix && number.startsWith(p.prefix) && p.prefix.length > bestLen) { best = p; bestLen = p.prefix.length; }
  }
  return best;
}

// ── Tab config ────────────────────────────────────────────────────────────────
const TABS: { id: ActiveTab; label: string; icon: any; desc: string }[] = [
  { id: 'client',     label: 'Client Report',    icon: Users,      desc: 'Origination analytics by customer / CLI' },
  { id: 'vendor',     label: 'Vendor Report',    icon: Server,     desc: 'Termination analytics by vendor / connection' },
  { id: 'connection', label: 'Connection',       icon: Layers,     desc: 'Per-account stats · origination + termination' },
  { id: 'revenue',    label: 'Revenue & Margin', icon: DollarSign, desc: 'P&L summary · margin analytics' },
];

export default function ReportsPage() {
  const now = new Date();
  const qc = useQueryClient();
  const { tz, tzAbbr } = useTimezone();

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('client');

  // ── Shared filter state (Client + Vendor tabs) ─────────────────────────────
  const [startTime, setStartTime] = useState(() => toInput(subHoursUTC(now, 1), tz));
  const [endTime,   setEndTime]   = useState(() => toInput(now, tz));
  const [activePreset, setActivePreset] = useState("Last 1 hr");
  const [cliFilter, setCliFilter]  = useState("");
  const [cldFilter, setCldFilter]  = useState("");
  const [partyType, setPartyType]  = useState<'all' | 'client' | 'vendor'>('all');
  const [highlightBelow, setHighlightBelow] = useState(10);
  const [sortBy, setSortBy]    = useState<'totalCalls' | 'asr' | 'billableCalls' | 'revenueUsd' | 'quality'>("totalCalls");
  const [hideEmpty, setHideEmpty] = useState(true);

  const [applied, setApplied] = useState({ cliFilter, cldFilter, startTime, endTime, sortBy, hideEmpty, tz });

  // ── Connection tab ──────────────────────────────────────────────────────────
  const [connPeriod, setConnPeriod] = useState(90);

  // ── Revenue tab ─────────────────────────────────────────────────────────────
  const [revDays, setRevDays] = useState(7);
  const [revRevSort, setRevRevSort] = useState<'revenue' | 'cost' | 'margin'>('revenue');

  // ── Live Degradation Intelligence ───────────────────────────────────────────
  const [degradeWindow, setDegradeWindow] = useState(60);
  const { data: degradeData, isLoading: degradeLoading } = useQuery<DegradationResponse>({
    queryKey: ['/api/reports/route-degradation', degradeWindow],
    queryFn: async () => {
      const params = new URLSearchParams({ window: String(degradeWindow), groupBy: 'callee' });
      const res = await fetch(`/api/reports/route-degradation?${params}`);
      if (!res.ok) throw new Error('Failed to fetch degradation data');
      return res.json();
    },
    enabled: activeTab === 'vendor',
    refetchInterval: 2 * 60_000,
    staleTime: 90_000,
  });

  // ── Route Recommendation Engine ──────────────────────────────────────────────
  const { data: routeRecData, isLoading: routeRecLoading } = useQuery<RouteRecommendationsResponse>({
    queryKey: ['/api/reports/route-recommendations'],
    queryFn: async () => {
      const res = await fetch('/api/reports/route-recommendations');
      if (!res.ok) throw new Error('Failed to fetch route recommendations');
      return res.json();
    },
    enabled: activeTab === 'vendor',
    refetchInterval: 5 * 60_000,
    staleTime: 3 * 60_000,
  });
  const [expandedRec, setExpandedRec] = useState<string | null>(null);

  // ── Monitor ─────────────────────────────────────────────────────────────────
  const [monitorHours, setMonitorHours] = useState<number>(24);

  const { data: profiles = [] } = useQuery<ClientProfile[]>({ queryKey: ['/api/clients'] });
  const { data: sippySession } = useQuery<{ active: boolean; username?: string }>({
    queryKey: ['/api/sippy/session'], refetchInterval: 30000,
  });

  // ── Derived groupBy based on active tab ────────────────────────────────────
  const groupBy = activeTab === 'vendor' ? 'callee' : 'caller';

  // ── ASR/ACD report query (Client + Vendor tabs) ────────────────────────────
  const { data: reportData, isLoading: reportLoading, dataUpdatedAt } = useQuery<{ rows: ReportRow[]; _source?: string; _cdrCount?: number } | ReportRow[]>({
    queryKey: ['/api/reports/asr-acd', applied, groupBy],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (applied.cliFilter) params.set('cli', applied.cliFilter);
      if (applied.cldFilter) params.set('cld', applied.cldFilter);
      if (applied.startTime) params.set('startTime', tzDateToUTC(applied.startTime, applied.tz).toISOString());
      if (applied.endTime)   params.set('endTime',   tzDateToUTC(applied.endTime,   applied.tz).toISOString());
      params.set('groupBy',   groupBy);
      // 'quality' is client-side only — tell the API to return all rows sorted by totalCalls
      params.set('sortBy',    applied.sortBy === 'quality' ? 'totalCalls' : applied.sortBy);
      params.set('hideEmpty', String(applied.hideEmpty));
      const res = await fetch(`/api/reports/asr-acd?${params}`);
      if (!res.ok) throw new Error('Failed to fetch report');
      return res.json();
    },
    enabled: activeTab === 'client' || activeTab === 'vendor',
  });
  const rows: ReportRow[] = Array.isArray(reportData) ? reportData : (reportData?.rows ?? []);
  const reportSource: string = Array.isArray(reportData) ? 'sippy-api' : (reportData?._source ?? 'sippy-api');
  const reportCdrCount: number = Array.isArray(reportData) ? rows.length : (reportData?._cdrCount ?? rows.length);

  const displayRows = useMemo(() => {
    const filtered = rows; // partyType filter placeholder
    if (sortBy === 'quality') {
      return [...filtered].sort((a, b) => computeQuality(b) - computeQuality(a));
    }
    return filtered;
  }, [rows, partyType, sortBy]);

  // Map from vendor key → degradation alert (for O(1) per-row lookup in table)
  const degradeAlertMap = useMemo(() => {
    const m = new Map<string, DegradationAlert>();
    for (const a of (degradeData?.alerts ?? [])) m.set(a.vendor, a);
    return m;
  }, [degradeData]);

  // ── Connection query ────────────────────────────────────────────────────────
  type ConnRow = { name: string; totalCalls: number; billableCalls: number; durationSec: number; acdSec: number; asr: number; avgPdd: number; amount: number };
  const { data: connData, isLoading: connLoading, refetch: refetchConn } = useQuery<{
    ok: boolean; period: string; fetchedAt: string;
    clients: ConnRow[]; vendors: ConnRow[];
    origTotal: ConnRow; termTotal: ConnRow; error?: string;
  }>({
    queryKey: ['/api/sippy/per-account-stats', connPeriod],
    queryFn: () => fetch(`/api/sippy/per-account-stats?period=${connPeriod}`).then(r => r.json()),
    enabled: activeTab === 'connection',
    refetchInterval: activeTab === 'connection' ? 60000 : false,
  });

  // ── Revenue query ────────────────────────────────────────────────────────────
  type RevRow = { name: string; calls: number; minutes: number; revenue: number; cost?: number; profit?: number; margin?: number };
  const { data: revData, isLoading: revLoading, refetch: refetchRev } = useQuery<{
    period: { days: number; since: string };
    summary: { totalRevenue: number; totalCost: number; totalProfit: number; margin: number };
    byClient: RevRow[]; byVendor: RevRow[];
    vendorDataLimited: boolean; _source: string;
  }>({
    queryKey: ['/api/analytics/revenue', revDays],
    queryFn: () => fetch(`/api/analytics/revenue?days=${revDays}`).then(r => r.json()),
    enabled: activeTab === 'revenue',
    staleTime: 120_000,
  });

  // ── Monitor query ───────────────────────────────────────────────────────────
  type MonitorPoint = { ts: number; acd?: number; asr?: number; [k: string]: number | undefined };
  const { data: monitorData, isLoading: monitorLoading, refetch: refetchMonitor } = useQuery<{ ok: boolean; points: MonitorPoint[]; error?: string }>({
    queryKey: ['/api/sippy/monitoring/acd-asr', monitorHours],
    queryFn: () => fetch(`/api/sippy/monitoring/acd-asr?hours=${monitorHours}`).then(r => r.json()),
    refetchInterval: 300000,
    enabled: sippySession?.active === true && (activeTab === 'client' || activeTab === 'vendor'),
  });


  // ── Totals ──────────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const totalCalls          = displayRows.reduce((s, r) => s + r.totalCalls, 0);
    const billableCalls       = displayRows.reduce((s, r) => s + r.billableCalls, 0);
    const billedDurationSeconds = displayRows.reduce((s, r) => s + r.billedDurationSeconds, 0);
    const revenueUsd          = displayRows.reduce((s, r) => s + r.revenueUsd, 0);
    const asr                 = displayRows.length > 0 ? displayRows.reduce((s, r) => s + r.asr, 0) / displayRows.length : 0;
    const acdSeconds          = billableCalls > 0 ? billedDurationSeconds / billableCalls : 0;
    const avgPdd              = displayRows.length > 0 ? displayRows.reduce((s, r) => s + r.avgPdd, 0) / displayRows.length : 0;
    // NER: use rnaCount when available (CDR-cache path); fall back to ASR average (portal path)
    const hasRnaData          = displayRows.some(r => r.rnaCount != null);
    const rnaTotal            = displayRows.reduce((s, r) => s + (r.rnaCount ?? 0), 0);
    const nerPct              = hasRnaData
      ? (totalCalls > 0 ? (billableCalls + rnaTotal) / totalCalls * 100 : 0)
      : (displayRows.length > 0 ? displayRows.reduce((s, r) => s + (r.nerPct ?? r.asr), 0) / displayRows.length : 0);
    // FAS rate: weighted by billable calls
    const fasWeighted         = displayRows.reduce((s, r) => s + (r.fasRate ?? 0) * r.billableCalls, 0);
    const fasRate             = billableCalls > 0 ? fasWeighted / billableCalls : 0;
    return { totalCalls, billableCalls, billedDurationSeconds, revenueUsd, asr, acdSeconds, avgPdd, nerPct, fasRate };
  }, [displayRows]);

  function applyFilters() { setApplied({ cliFilter, cldFilter, startTime, endTime, sortBy: sortBy as any, hideEmpty, tz }); }
  function applyPreset(label: string, fn: () => [Date, Date]) {
    const [start, end] = fn();
    setStartTime(toInput(start, tz));
    setEndTime(toInput(end, tz));
    setActivePreset(label);
    setApplied(prev => ({ ...prev, startTime: toInput(start, tz), endTime: toInput(end, tz), tz }));
  }

  function downloadCsv() {
    const headers = ['Caller/Callee', 'Total Calls', 'Billable Calls', 'Billed Duration', 'ACD', 'ASR %', 'Avg PDD', 'Revenue USD'];
    const csvRows = displayRows.map(r => [
      r.caller, r.totalCalls, r.billableCalls,
      fmtDuration(r.billedDurationSeconds), fmtDuration(r.acdSeconds),
      r.asr.toFixed(4), r.avgPdd.toFixed(3), r.revenueUsd.toFixed(4),
    ].join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTab}_report_${formatUTC(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const toAppliedUTC = (s: string) => tzDateToUTC(s, applied.tz || tz);
  const rangeLabel = `${formatInTz(toAppliedUTC(applied.startTime || startTime), 'd MMM HH:mm', applied.tz || tz)} → ${formatInTz(toAppliedUTC(applied.endTime || endTime), 'd MMM HH:mm', applied.tz || tz)} ${tzAbbr}`;

  // ── Revenue chart data ──────────────────────────────────────────────────────
  const revChartData = useMemo(() => {
    if (!revData?.byClient) return [];
    return revData.byClient.slice(0, 10).map(r => ({
      name: r.name.length > 14 ? r.name.slice(0, 14) + '…' : r.name,
      Revenue: parseFloat((r.revenue || 0).toFixed(2)),
      Cost:    parseFloat((r.cost    || 0).toFixed(2)),
      Profit:  parseFloat((r.profit  || 0).toFixed(2)),
    }));
  }, [revData]);

  return (
    <div className="space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Analytics & Reports</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            ASR / ACD · Vendor · Client · Connection · Revenue &amp; Margin
          </p>
        </div>
        {(activeTab === 'client' || activeTab === 'vendor') && (
          <button
            data-testid="button-download-csv"
            onClick={downloadCsv}
            disabled={displayRows.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        )}
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap border-b border-border/50 pb-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            data-testid={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border/60"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          CLIENT + VENDOR TABS — shared filter panel + ASR/ACD table
         ════════════════════════════════════════════════════════════════════════ */}
      {(activeTab === 'client' || activeTab === 'vendor') && (
        <>
          {/* Sub-header with range */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="w-3.5 h-3.5" />
            {rangeLabel}
            {dataUpdatedAt > 0 && (
              <span className="text-muted-foreground/50 ml-2">
                · Updated {formatInTz(new Date(dataUpdatedAt), 'HH:mm:ss', tz)} {tzAbbr}
              </span>
            )}
          </div>

          {/* Filter Panel */}
          <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-3 border-b border-border/50 bg-muted/20">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters &amp; Time Range</span>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time Range</span>
                  <span className="text-xs text-muted-foreground/60 ml-1">({tzAbbr})</span>
                </div>
                <div className="space-y-2 mb-4">
                  {PRESET_GROUPS.map(group => (
                    <div key={group.label} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground/60 w-14 flex-shrink-0">{group.label}</span>
                      {group.presets.map(p => (
                        <button
                          key={p.label}
                          data-testid={`preset-${p.label.replace(/\s/g, '-').toLowerCase()}`}
                          onClick={() => applyPreset(p.label, p.fn)}
                          className={cn(
                            "px-3 py-1 rounded-md text-xs border transition-colors",
                            activePreset === p.label
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">From ({tzAbbr})</label>
                    <input data-testid="input-start-time" type="datetime-local" value={startTime}
                      onChange={e => { setStartTime(e.target.value); setActivePreset(''); }}
                      className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">To ({tzAbbr})</label>
                    <input data-testid="input-end-time" type="datetime-local" value={endTime}
                      onChange={e => { setEndTime(e.target.value); setActivePreset(''); }}
                      className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                  </div>
                </div>
              </div>

              <div className="border-t border-border/40 pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">CLI (Caller)</label>
                  <input data-testid="input-cli-filter" value={cliFilter}
                    onChange={e => setCliFilter(e.target.value)} placeholder="e.g. +1212"
                    className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">CLD (Destination)</label>
                  <input data-testid="input-cld-filter" value={cldFilter}
                    onChange={e => setCldFilter(e.target.value)} placeholder="e.g. +44"
                    className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Sort By</label>
                  <select data-testid="select-sort-by" value={sortBy}
                    onChange={e => setSortBy(e.target.value as any)}
                    className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                    <option value="totalCalls">Number of Calls</option>
                    <option value="billableCalls">Billable Calls</option>
                    <option value="asr">ASR %</option>
                    <option value="revenueUsd">Revenue</option>
                    <option value="quality">Quality Score ↓</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Highlight ASR below %</label>
                  <input data-testid="input-highlight-asr" type="number" value={highlightBelow}
                    onChange={e => setHighlightBelow(Number(e.target.value))} min={0} max={100}
                    className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Hide Entries w/o Calls</label>
                  <div className="flex items-center h-9 gap-2">
                    <input data-testid="checkbox-hide-empty" type="checkbox" checked={hideEmpty}
                      onChange={e => setHideEmpty(e.target.checked)} className="w-4 h-4 rounded accent-primary" />
                    <span className="text-sm text-muted-foreground">{hideEmpty ? 'Yes' : 'No'}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button data-testid="button-update-report" onClick={applyFilters} disabled={reportLoading}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60">
                  <RefreshCw className={cn("w-3.5 h-3.5", reportLoading && "animate-spin")} />
                  Update Report
                </button>
              </div>
            </div>
          </div>

          {/* Source notices */}
          {reportSource === 'sippy-portal' && !reportLoading && rows.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 px-4 py-3 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span><span className="font-medium">Live Sippy data —</span> Rows grouped by {groupBy === 'caller' ? 'customer account' : 'vendor connection'}.</span>
            </div>
          )}
          {reportSource === 'cdr-cache' && !reportLoading && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 px-4 py-3 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span><span className="font-medium">CDR cache —</span> Based on {reportCdrCount.toLocaleString()} CDRs from the 72-hour cache. Date filters applied in-memory.</span>
            </div>
          )}

          {/* KPI Summary */}
          {displayRows.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Total Calls",    value: totals.totalCalls.toLocaleString(),    color: "text-blue-400",    icon: PhoneCall },
                { label: "Billable Calls", value: totals.billableCalls.toLocaleString(), color: "text-emerald-400", icon: CheckCircle2 },
                { label: "Avg ASR",        value: `${totals.asr.toFixed(2)}%`,           color: totals.asr >= 50 ? "text-emerald-400" : "text-rose-400", icon: TrendingUp },
                { label: "NER",            value: `${totals.nerPct.toFixed(2)}%`,         color: totals.nerPct >= 60 ? "text-cyan-400" : totals.nerPct >= 40 ? "text-amber-400" : "text-rose-400", icon: Wifi,
                  tooltip: "Network Effectiveness Ratio — includes ring-no-answer in numerator" },
                { label: "Avg ACD",        value: fmtDuration(totals.acdSeconds),         color: "text-violet-400",  icon: Clock },
                { label: "Revenue (USD)",  value: `$${totals.revenueUsd.toFixed(2)}`,     color: "text-amber-400",   icon: DollarSign },
              ].map(stat => (
                <div key={stat.label} className="bg-card rounded-xl border border-border p-4" data-testid={`stat-${stat.label.toLowerCase().replace(/[\s()]+/g, '-')}`} title={(stat as any).tooltip}>
                  <div className="flex items-center gap-2 mb-1">
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                    <span className="text-xs text-muted-foreground">{stat.label}</span>
                  </div>
                  <p className={`text-xl font-bold tabular-nums ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* ASR/ACD Monitor chart */}
          {sippySession?.active && (
            <div className="rounded-xl border overflow-hidden bg-card/60 shadow-sm border-violet-500/20" data-testid="sippy-monitor-panel">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
                <div className="flex items-center gap-3">
                  <Activity className="w-4 h-4 text-violet-400" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">Sippy ACD / ASR Monitor</h3>
                      <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">Live · Sippy API</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Real-time ACD and ASR from Sippy — with industry benchmarks</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {([6, 12, 24, 48] as const).map(h => (
                    <button key={h} data-testid={`monitor-hours-${h}`} onClick={() => setMonitorHours(h)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${monitorHours === h ? 'bg-violet-500/15 border-violet-500/30 text-violet-400 font-semibold' : 'border-border/50 text-muted-foreground hover:text-foreground'}`}>
                      {h}h
                    </button>
                  ))}
                  <button data-testid="monitor-refresh" onClick={() => refetchMonitor()} disabled={monitorLoading}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40">
                    <RefreshCw className={`w-3.5 h-3.5 ${monitorLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
              <div className="p-6">
                {monitorLoading ? (
                  <Skeleton className="h-48 w-full rounded-xl" />
                ) : !monitorData?.ok || !monitorData?.points?.length ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground/60">
                    <Activity className="w-8 h-8 opacity-30" />
                    <span className="text-sm">{monitorData?.error ?? 'No CDR data found for this time range'}</span>
                    <span className="text-xs opacity-70">Try a wider range or run again after calls complete.</span>
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={monitorData.points.map(p => ({
                        time: formatInTz(new Date(p.ts * 1000), 'HH:mm', tz),
                        acd: p.acd != null ? Math.round(p.acd) : undefined,
                        asr: p.asr != null ? parseFloat(p.asr.toFixed(1)) : undefined,
                      }))}>
                        <CartesianGrid {...BSE_GRID_PROPS} />
                        <XAxis dataKey="time" {...BSE_AXIS_PROPS} interval="preserveStartEnd" />
                        <YAxis yAxisId="acd" orientation="left" {...BSE_AXIS_PROPS} tickFormatter={v => `${v}s`}
                          label={{ value: 'ACD (sec)', angle: -90, position: 'insideLeft', style: { fill: 'rgba(148,163,184,0.5)', fontSize: 9, fontFamily: 'monospace' }, dx: 10 }} />
                        <YAxis yAxisId="asr" orientation="right" domain={[0, 100]} {...BSE_AXIS_PROPS} tickFormatter={v => `${v}%`}
                          label={{ value: 'ASR (%)', angle: 90, position: 'insideRight', style: { fill: 'rgba(148,163,184,0.5)', fontSize: 9, fontFamily: 'monospace' }, dx: -5 }} />
                        <RcTooltip content={<BseTooltip formatter={(v: number, key) => key === 'acd' ? [`${v}s`, 'ACD'] : [`${v}%`, 'ASR']} />} cursor={BSE_CURSOR} />
                        <Legend formatter={v => v === 'acd' ? 'ACD (sec)' : 'ASR (%)'} wrapperStyle={{ fontSize: 10, paddingTop: 8, color: 'rgba(148,163,184,0.7)' }} />
                        <ReferenceLine yAxisId="asr" y={70} stroke="#10b981" strokeDasharray="6 3" strokeWidth={1.5}
                          label={{ value: 'National ~70%', position: 'insideTopRight', style: { fill: '#10b981', fontSize: 10 } }} />
                        <ReferenceLine yAxisId="asr" y={50} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5}
                          label={{ value: 'Wholesale ~50%', position: 'insideTopRight', style: { fill: '#f59e0b', fontSize: 10 } }} />
                        <ReferenceLine yAxisId="asr" y={20} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={1.5}
                          label={{ value: 'Call Center <20%', position: 'insideTopRight', style: { fill: '#ef4444', fontSize: 10 } }} />
                        <ReferenceLine yAxisId="acd" y={480} stroke="#818cf8" strokeDasharray="4 4" strokeWidth={1}
                          label={{ value: 'Retail ACD ~8min', position: 'insideTopLeft', style: { fill: '#818cf8', fontSize: 10 } }} />
                        <Line yAxisId="acd" type="monotone" dataKey="acd" stroke="#818cf8" strokeWidth={2} dot={false} activeDot={bseActiveDot('#818cf8')} connectNulls strokeLinecap="round" />
                        <Line yAxisId="asr" type="monotone" dataKey="asr" stroke="#34d399" strokeWidth={2.5} dot={false} activeDot={bseActiveDot('#34d399')} connectNulls strokeLinecap="round" />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'National carrier', range: '≥70% ASR', color: 'text-emerald-400', dot: 'bg-emerald-400' },
                        { label: 'Wholesale SIP', range: '~50% ASR', color: 'text-amber-400', dot: 'bg-amber-400' },
                        { label: 'Call center', range: '<20% ASR', color: 'text-red-400', dot: 'bg-red-400' },
                        { label: 'Retail ACD target', range: '≥480s ACD', color: 'text-violet-400', dot: 'bg-violet-400' },
                      ].map(b => (
                        <div key={b.label} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/40">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${b.dot}`} />
                          <div>
                            <p className="text-xs font-medium">{b.label}</p>
                            <p className={`text-xs ${b.color} font-semibold`}>{b.range}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Live Degradation Monitor (vendor tab only) ──────────────── */}
          {activeTab === 'vendor' && (() => {
            const alerts = degradeData?.alerts ?? [];
            const degrading = alerts.filter(a => a.trend === 'degrading');
            const critical  = alerts.filter(a => a.severity === 'critical');
            const improving = alerts.filter(a => a.trend === 'improving');
            const displayed = degrading.slice(0, 5);
            const isStable  = !degradeLoading && alerts.length > 0 && degrading.length === 0;
            return (
              <div className={cn(
                "rounded-xl border overflow-hidden",
                critical.length > 0 ? "border-rose-500/40 bg-rose-500/5" :
                degrading.length > 0 ? "border-amber-500/30 bg-amber-500/5" :
                "border-border/50 bg-card/50"
              )} data-testid="degradation-panel">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/10 flex-wrap">
                  <Activity className={cn("w-4 h-4", critical.length > 0 ? "text-rose-400 animate-pulse" : degrading.length > 0 ? "text-amber-400" : "text-emerald-400")} />
                  <span className="text-sm font-semibold">Live Degradation Monitor</span>
                  {degradeData && (
                    <span className="text-[10px] text-muted-foreground">
                      comparing last {degradeData.windowMinutes}m vs prior {degradeData.windowMinutes}m · {degradeData.cdrCount} CDRs · updated {new Date(degradeData.generatedAt).toLocaleTimeString()}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <label className="text-[10px] text-muted-foreground">Window:</label>
                    <select data-testid="select-degrade-window" value={degradeWindow}
                      onChange={e => setDegradeWindow(Number(e.target.value))}
                      className="h-7 text-xs rounded border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-primary/30">
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={60}>1 hour</option>
                      <option value={120}>2 hours</option>
                      <option value={240}>4 hours</option>
                    </select>
                  </div>
                </div>
                <div className="p-4">
                  {degradeLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analyzing route quality trends…
                    </div>
                  ) : isStable ? (
                    <div className="flex items-center gap-2 py-2">
                      <BadgeCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-emerald-400 font-medium">All {degradeData?.totalVendors} routes stable</span>
                      {improving.length > 0 && (
                        <span className="text-xs text-muted-foreground">· {improving.length} improving</span>
                      )}
                    </div>
                  ) : degradeData && alerts.length === 0 ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                      <Minus className="w-3.5 h-3.5" />
                      Insufficient CDR history for comparison — needs ≥5 calls per vendor per window
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {displayed.map((alert) => (
                        <div key={alert.vendor}
                          data-testid={`degrade-alert-${alert.vendor}`}
                          className={cn(
                            "flex items-start gap-3 px-3 py-2.5 rounded-lg border",
                            alert.severity === 'critical' ? "border-rose-500/40 bg-rose-500/10" :
                            alert.severity === 'warning'  ? "border-amber-500/30 bg-amber-500/10" :
                                                            "border-orange-500/20 bg-orange-500/5"
                          )}>
                          <div className="flex-shrink-0 mt-0.5">
                            {alert.severity === 'critical' ? (
                              <TriangleAlert className="w-4 h-4 text-rose-400" />
                            ) : alert.severity === 'warning' ? (
                              <AlertTriangle className="w-4 h-4 text-amber-400" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-orange-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-foreground">{alert.vendor}</span>
                              <span className={cn(
                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold",
                                alert.severity === 'critical' ? "bg-rose-500/20 text-rose-300" :
                                alert.severity === 'warning'  ? "bg-amber-500/20 text-amber-300" :
                                                                "bg-orange-500/20 text-orange-300"
                              )}>
                                <TrendingDown className="w-2.5 h-2.5" />
                                Q {alert.previousQ ?? '?'} → {alert.currentQ}
                                {' '}({alert.deltaQ > 0 ? '+' : ''}{alert.deltaQ})
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {alert.callCount} calls · ASR {alert.currentAsr}%
                              </span>
                            </div>
                            {alert.signals.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {alert.signals.map((sig, si) => (
                                  <span key={si} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono">
                                    {sig}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {degrading.length > 5 && (
                        <p className="text-[10px] text-muted-foreground text-center pt-1">
                          +{degrading.length - 5} more degrading routes
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Route Recommendation Engine (vendor tab only) ───────────── */}
          {activeTab === 'vendor' && (() => {
            const recs       = routeRecData?.recommendations ?? [];
            const urgent     = recs.filter(r => r.urgency === 'immediate');
            const todayRecs  = recs.filter(r => r.urgency === 'today');
            const positive   = recs.filter(r => r.type === 'PROMOTE');
            const hasUrgent  = urgent.length > 0;

            // Type metadata
            const typeConfig: Record<RouteRecommendationType, { label: string; color: string; bg: string; accent: string; border: string }> = {
              INVESTIGATE:     { label: 'Investigate',     color: 'text-rose-300',    bg: 'bg-rose-500/20 border-rose-500/40',    accent: 'text-rose-200',    border: 'border-rose-500/30'    },
              FAS_ALERT:       { label: 'FAS Alert',       color: 'text-rose-300',    bg: 'bg-rose-500/15 border-rose-500/30',    accent: 'text-rose-200',    border: 'border-rose-500/25'    },
              REDUCE_PRIORITY: { label: 'Reduce Priority', color: 'text-amber-300',   bg: 'bg-amber-500/15 border-amber-500/30',  accent: 'text-amber-200',   border: 'border-amber-500/25'   },
              MONITOR:         { label: 'Monitor',         color: 'text-sky-300',     bg: 'bg-sky-500/10 border-sky-500/20',      accent: 'text-sky-200',     border: 'border-sky-500/20'     },
              PROMOTE:         { label: 'Promote',         color: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/25', accent: 'text-emerald-200', border: 'border-emerald-500/20' },
            };

            // Shared RCA drawer component
            const RcaDrawer = ({ rec }: { rec: RouteRecommendation }) => {
              const { rca } = rec;
              const correlatedAlert = degradeAlertMap?.get(rec.vendor);
              const sigStatusCls = (s: 'critical'|'warning'|'ok') =>
                s === 'critical' ? 'text-rose-400' : s === 'warning' ? 'text-amber-400' : 'text-emerald-400';
              const deltaFmt = (cur: number|null, prev: number|null) => {
                if (cur === null || prev === null) return null;
                const d = parseFloat((cur - prev).toFixed(1));
                return d === 0 ? '—' : (d > 0 ? `+${d}` : `${d}`);
              };
              const deltaColor = (cur: number|null, prev: number|null, higher = true) => {
                if (cur === null || prev === null) return 'text-muted-foreground';
                const d = cur - prev;
                if (Math.abs(d) < 0.5) return 'text-muted-foreground';
                return (d > 0) === higher ? 'text-emerald-400' : 'text-rose-400';
              };

              return (
                <div className="mt-2 border-t border-border/40 pt-3 space-y-4" data-testid={`rca-drawer-${rec.vendor}`}>

                  {/* ── Section 1: Signal comparison table ── */}
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 font-semibold">Signal Comparison — Previous 60m vs Current 60m</p>
                    <div className="rounded-lg border border-border/40 overflow-hidden">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="bg-muted/20 border-b border-border/30">
                            <th className="text-left px-2.5 py-1.5 text-muted-foreground font-medium">Signal</th>
                            <th className="text-center px-2.5 py-1.5 text-muted-foreground font-medium">Weight</th>
                            <th className="text-right px-2.5 py-1.5 text-muted-foreground font-medium">Previous</th>
                            <th className="text-right px-2.5 py-1.5 text-muted-foreground font-medium">Current</th>
                            <th className="text-right px-2.5 py-1.5 text-muted-foreground font-medium">Delta</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/20">
                          {rca.signalContributions.map((sc) => {
                            const curVal  = sc.signal === 'ASR' ? rca.signals.cur.asr
                                          : sc.signal === 'NER' ? rca.signals.cur.ner
                                          : sc.signal === 'FAS' ? rca.signals.cur.fas
                                          : rca.signals.cur.pdd;
                            const prevVal = sc.signal === 'ASR' ? rca.signals.prev.asr
                                          : sc.signal === 'NER' ? rca.signals.prev.ner
                                          : sc.signal === 'FAS' ? rca.signals.prev.fas
                                          : rca.signals.prev.pdd;
                            const higher  = sc.signal !== 'FAS' && sc.signal !== 'PDD';
                            const dStr    = deltaFmt(curVal, prevVal);
                            const dCls    = deltaColor(curVal, prevVal, higher);
                            return (
                              <tr key={sc.signal} className="hover:bg-muted/5">
                                <td className="px-2.5 py-1.5 font-mono font-semibold">
                                  <span className={sigStatusCls(sc.status)}>{sc.signal}</span>
                                </td>
                                <td className="px-2.5 py-1.5 text-center text-muted-foreground/60 font-mono">{sc.weight}</td>
                                <td className="px-2.5 py-1.5 text-right text-muted-foreground font-mono">
                                  {prevVal !== null ? sc.prev : <span className="text-muted-foreground/40">—</span>}
                                </td>
                                <td className={cn("px-2.5 py-1.5 text-right font-mono font-semibold", sigStatusCls(sc.status))}>{sc.value}</td>
                                <td className={cn("px-2.5 py-1.5 text-right font-mono font-bold", dCls)}>{dStr ?? '—'}</td>
                              </tr>
                            );
                          })}
                          {/* Q-Score summary row */}
                          <tr className="bg-muted/10 border-t border-border/40">
                            <td className="px-2.5 py-1.5 font-semibold text-foreground">Q-Score</td>
                            <td className="px-2.5 py-1.5 text-center text-muted-foreground/60 font-mono">composite</td>
                            <td className="px-2.5 py-1.5 text-right text-muted-foreground font-mono">
                              {rca.signals.prev.q !== null ? `Q${rca.signals.prev.q}` : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className={cn("px-2.5 py-1.5 text-right font-mono font-bold",
                              rec.currentQ < 25 ? 'text-rose-400' : rec.currentQ < 55 ? 'text-amber-400' : 'text-emerald-400')}>
                              Q{rca.signals.cur.q}
                            </td>
                            <td className={cn("px-2.5 py-1.5 text-right font-mono font-bold",
                              rec.deltaQ === null ? 'text-muted-foreground' : rec.deltaQ < 0 ? 'text-rose-400' : rec.deltaQ > 0 ? 'text-emerald-400' : 'text-muted-foreground')}>
                              {rec.deltaQ !== null ? (rec.deltaQ > 0 ? `+${rec.deltaQ}` : `${rec.deltaQ}`) : '—'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ── Section 2: Rule trigger ── */}
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 font-semibold">Rule Trigger</p>
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-muted/10 border border-border/30">
                      <span className={cn("px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider flex-shrink-0 mt-0.5",
                        typeConfig[rec.type].bg, typeConfig[rec.type].color)}>
                        {typeConfig[rec.type].label}
                      </span>
                      <p className="text-[10px] text-muted-foreground font-mono leading-relaxed">{rca.ruleDescription}</p>
                    </div>
                  </div>

                  {/* ── Section 3: Top destinations ── */}
                  {rca.topDestinations.length > 0 && (
                    <div>
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 font-semibold">
                        Top Destinations via {rec.vendor} — Last 60m
                      </p>
                      <div className="rounded-lg border border-border/40 overflow-hidden">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="bg-muted/20 border-b border-border/30">
                              <th className="text-left px-2.5 py-1.5 text-muted-foreground font-medium">Destination</th>
                              <th className="text-right px-2.5 py-1.5 text-muted-foreground font-medium">Calls</th>
                              <th className="text-right px-2.5 py-1.5 text-muted-foreground font-medium">ASR</th>
                              <th className="text-right px-2.5 py-1.5 text-muted-foreground font-medium">FAS</th>
                              <th className="text-right px-2.5 py-1.5 text-muted-foreground font-medium">Est. Q</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {rca.topDestinations.map((dest) => (
                              <tr key={dest.cld} className="hover:bg-muted/5">
                                <td className="px-2.5 py-1.5 font-mono text-foreground/80">{dest.cld}</td>
                                <td className="px-2.5 py-1.5 text-right text-muted-foreground">{dest.calls}</td>
                                <td className={cn("px-2.5 py-1.5 text-right font-mono",
                                  dest.asr < 30 ? 'text-rose-400' : dest.asr < 55 ? 'text-amber-400' : 'text-emerald-400')}>
                                  {dest.asr}%
                                </td>
                                <td className={cn("px-2.5 py-1.5 text-right font-mono",
                                  dest.fas > 20 ? 'text-rose-400' : dest.fas > 8 ? 'text-amber-400' : 'text-muted-foreground')}>
                                  {dest.fas}%
                                </td>
                                <td className={cn("px-2.5 py-1.5 text-right font-mono font-semibold",
                                  dest.q < 40 ? 'text-rose-400' : dest.q < 65 ? 'text-amber-400' : 'text-emerald-400')}>
                                  Q{dest.q}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── Section 4: Correlated degradation alerts ── */}
                  {correlatedAlert && (
                    <div>
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 font-semibold">
                        Correlated Degradation Signals
                      </p>
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-amber-300 font-semibold">
                            Degradation monitor also flagged this vendor
                            {correlatedAlert.severity !== 'ok' && ` — ${correlatedAlert.severity.toUpperCase()}`}
                          </p>
                          {correlatedAlert.signals?.map((sig: string, si: number) => (
                            <p key={si} className="text-[10px] text-muted-foreground font-mono">› {sig}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            // Shared recommendation card renderer (used by all sections)
            const RecCard = ({ rec, defaultOpen = false }: { rec: RouteRecommendation; defaultOpen?: boolean }) => {
              const cfg      = typeConfig[rec.type];
              const isOpen   = expandedRec === rec.vendor;
              const icon     = rec.urgency === 'immediate'
                ? <TriangleAlert className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                : rec.type === 'PROMOTE'
                  ? <BadgeCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />;
              const cardBorder = rec.urgency === 'immediate' ? 'border-rose-500/30 bg-rose-500/5'
                : rec.type === 'PROMOTE' ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-amber-500/20 bg-amber-500/5';

              return (
                <div className={cn("rounded-lg border overflow-hidden transition-all", cardBorder)}
                  data-testid={`rec-${rec.type}-${rec.vendor}`}>
                  {/* Card header — clickable */}
                  <button
                    className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/5 transition-colors"
                    onClick={() => setExpandedRec(isOpen ? null : rec.vendor)}
                    data-testid={`rec-expand-${rec.vendor}`}
                  >
                    {icon}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-xs font-bold text-foreground">{rec.vendor}</span>
                        <span className={cn("px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider", cfg.bg, cfg.color)}>
                          {cfg.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">Q{rec.currentQ} · {rec.callCount} calls</span>
                        <span className="ml-auto flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground/60">{rec.confidence}% conf.</span>
                          <ChevronDown className={cn("w-3 h-3 text-muted-foreground/50 transition-transform", isOpen && "rotate-180")} />
                        </span>
                      </div>
                      <p className={cn("text-[11px] font-semibold", cfg.accent)}>{rec.title}</p>
                      {!isOpen && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{rec.detail[0]}</p>
                      )}
                    </div>
                  </button>

                  {/* RCA drawer */}
                  {isOpen && (
                    <div className="px-3 pb-3">
                      <RcaDrawer rec={rec} />
                    </div>
                  )}
                </div>
              );
            };

            return (
              <div className={cn(
                "rounded-xl border overflow-hidden",
                hasUrgent ? "border-rose-500/35" : "border-border/50 bg-card/50"
              )} data-testid="route-recommendations-panel">
                {/* Header */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/10 flex-wrap">
                  <Zap className={cn("w-4 h-4", hasUrgent ? "text-rose-400 animate-pulse" : "text-sky-400")} />
                  <span className="text-sm font-semibold">Route Recommendation Engine</span>
                  {routeRecData && (
                    <span className="text-[10px] text-muted-foreground">
                      {routeRecData.totalVendors} vendors · {routeRecData.cdrCount} CDRs · last hour window
                    </span>
                  )}
                  {hasUrgent && (
                    <span className="ml-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                      {urgent.length} immediate action{urgent.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {routeRecData && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      click any card for RCA · updated {new Date(routeRecData.generatedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>

                <div className="p-4">
                  {routeRecLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analysing route quality signals…
                    </div>
                  ) : recs.length === 0 ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                      <Minus className="w-3.5 h-3.5" />
                      Insufficient CDR data — needs ≥5 calls per vendor in the last hour
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Immediate actions */}
                      {urgent.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-wider text-rose-400/80 font-semibold flex items-center gap-1.5">
                            <TriangleAlert className="w-3 h-3" /> Immediate Actions
                          </p>
                          {urgent.map((rec) => <RecCard key={rec.vendor} rec={rec} defaultOpen />)}
                        </div>
                      )}

                      {/* Review today */}
                      {todayRecs.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-wider text-amber-400/80 font-semibold flex items-center gap-1.5">
                            <Activity className="w-3 h-3" /> Review Today
                          </p>
                          {todayRecs.slice(0, 4).map((rec) => <RecCard key={rec.vendor} rec={rec} />)}
                          {todayRecs.length > 4 && (
                            <p className="text-[10px] text-muted-foreground pl-1">+{todayRecs.length - 4} more to review</p>
                          )}
                        </div>
                      )}

                      {/* Strong routes */}
                      {positive.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-wider text-emerald-400/80 font-semibold flex items-center gap-1.5">
                            <BadgeCheck className="w-3 h-3" /> Strong Routes
                          </p>
                          {positive.map((rec) => <RecCard key={rec.vendor} rec={rec} />)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Route Intelligence Panel (vendor tab only) ─────────────── */}
          {activeTab === 'vendor' && !reportLoading && displayRows.length > 0 && (() => {
            const scored = displayRows.map(r => ({ ...r, q: computeQuality(r) }));
            const avgQ      = Math.round(scored.reduce((s, r) => s + r.q, 0) / scored.length);
            const critical  = scored.filter(r => r.q < 30);
            const highFas   = scored.filter(r => (r.fasRate ?? 0) >= 15 && r.billableCalls > 0);
            const topVendor = [...scored].sort((a, b) => b.q - a.q)[0];
            const worst     = [...scored].sort((a, b) => a.q - b.q).slice(0, 3).filter(r => r.q < 50);
            return (
              <div className="rounded-xl border border-violet-500/20 bg-card/50 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/10">
                  <Gauge className="w-4 h-4 text-violet-400" />
                  <span className="text-sm font-semibold">Route Intelligence</span>
                  <span className="text-xs text-muted-foreground ml-1">— composite quality signals across all termination routes</span>
                  {sortBy !== 'quality' && (
                    <button onClick={() => setSortBy('quality')}
                      className="ml-auto text-xs px-2.5 py-1 rounded-md border border-violet-500/30 text-violet-400 hover:bg-violet-500/10 transition-colors">
                      Sort by Q-Score ↓
                    </button>
                  )}
                </div>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className={cn("rounded-lg border p-3", avgQ >= 70 ? "border-emerald-500/30 bg-emerald-500/5" : avgQ >= 50 ? "border-amber-500/30 bg-amber-500/5" : "border-rose-500/30 bg-rose-500/5")} data-testid="stat-avg-quality">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Gauge className={`w-3.5 h-3.5 ${qualityColor(avgQ)}`} />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Q-Score</span>
                    </div>
                    <p className={`text-2xl font-bold tabular-nums ${qualityColor(avgQ)}`}>{avgQ}</p>
                    <p className={`text-[10px] font-medium mt-0.5 ${qualityColor(avgQ)}`}>{qualityLabel(avgQ)}</p>
                  </div>
                  <div className={cn("rounded-lg border p-3", critical.length === 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5")} data-testid="stat-critical-routes">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TriangleAlert className={`w-3.5 h-3.5 ${critical.length === 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Critical Routes</span>
                    </div>
                    <p className={`text-2xl font-bold tabular-nums ${critical.length === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{critical.length}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Q-score &lt; 30</p>
                  </div>
                  <div className={cn("rounded-lg border p-3", highFas.length === 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")} data-testid="stat-fas-elevated">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Zap className={`w-3.5 h-3.5 ${highFas.length === 0 ? 'text-emerald-400' : 'text-amber-400'}`} />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">FAS Elevated</span>
                    </div>
                    <p className={`text-2xl font-bold tabular-nums ${highFas.length === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>{highFas.length}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">FAS risk ≥ 15 %</p>
                  </div>
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3" data-testid="stat-top-vendor">
                    <div className="flex items-center gap-1.5 mb-1">
                      <BadgeCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Top Route</span>
                    </div>
                    <p className="text-sm font-semibold text-emerald-400 truncate">{topVendor?.caller || '—'}</p>
                    <p className="text-[10px] text-emerald-400/70 mt-0.5">Q-score: {topVendor?.q ?? 0}</p>
                  </div>
                </div>
                {worst.length > 0 && (
                  <div className="border-t border-border/40 px-5 py-3 bg-rose-500/5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider text-rose-400/80 font-semibold flex-shrink-0">Routes needing attention:</span>
                      {worst.map(r => (
                        <span key={r.caller} className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium", qualityBg(r.q), qualityColor(r.q))}>
                          {r.caller} · Q:{r.q}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── ASR/ACD Table ─────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
            <div className="px-6 py-3 border-b border-border/50 bg-muted/20 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {activeTab === 'client' ? <Users className="w-4 h-4 text-emerald-400" /> : <Server className="w-4 h-4 text-violet-400" />}
                <span className="text-sm font-semibold">
                  {activeTab === 'client' ? 'Client Report — Origination (by Caller/CLI)' : 'Vendor Report — Termination (by Vendor/CLD)'}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">{displayRows.length} parties · {totals.totalCalls.toLocaleString()} calls</span>
            </div>
            {reportLoading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Generating report…
              </div>
            ) : displayRows.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">No data found for the selected filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left font-semibold">{groupBy === 'caller' ? 'Client / CLI' : 'Vendor / CLD'}</th>
                      <th className="px-4 py-3 text-right font-semibold">Calls</th>
                      <th className="px-4 py-3 text-right font-semibold">Billable</th>
                      <th className="px-4 py-3 text-right font-semibold">Billed Duration</th>
                      <th className="px-4 py-3 text-right font-semibold">ACD</th>
                      <th className="px-4 py-3 text-right font-semibold">ASR %</th>
                      <th className="px-4 py-3 text-right font-semibold" title="Network Effectiveness Ratio — incl. ring-no-answer">NER %</th>
                      {activeTab === 'vendor' && (
                        <th className="px-4 py-3 text-right font-semibold" title="FAS risk — short-billed answered calls ≤ 5 s">FAS Risk</th>
                      )}
                      <th className="px-4 py-3 text-right font-semibold" title="Composite Route Quality Score — ASR 40% + NER 30% + FAS 20% + PDD 10%">Q-Score</th>
                      <th className="px-4 py-3 text-right font-semibold">Avg PDD</th>
                      <th className="px-4 py-3 text-right font-semibold">Revenue USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row, i) => {
                      const isLowAsr = row.asr < highlightBelow;
                      const matched = matchProfile(row.caller, profiles, groupBy === 'caller' ? 'client' : 'vendor', row.caller);
                      const displayName = row.clientName || matched?.name;
                      const flag = countryFlag(row.country);
                      const ner = row.nerPct ?? row.asr;
                      const fas = row.fasRate ?? 0;
                      const fasLevel = fas >= 15 ? 'high' : fas >= 5 ? 'med' : 'low';
                      return (
                        <tr key={row.caller} data-testid={`row-report-${i}`}
                          className={cn("border-b border-border/30 transition-colors hover:bg-muted/20", isLowAsr ? "bg-rose-500/5" : "")}>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col gap-0.5">
                              {displayName && (
                                <span className={cn("text-xs font-semibold leading-tight", matched?.type === 'vendor' ? 'text-violet-400' : 'text-emerald-400')}>
                                  {displayName}
                                </span>
                              )}
                              <span className={cn("font-mono text-xs leading-tight", isLowAsr ? "text-rose-400" : "text-blue-400")}>{row.caller}</span>
                              {row.country && (
                                <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1 leading-tight">
                                  {flag && <span className="text-sm leading-none">{flag}</span>}
                                  {row.country}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{row.totalCalls.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{row.billableCalls.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(row.billedDurationSeconds)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(row.acdSeconds)}</td>
                          <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", isLowAsr ? "text-rose-400" : row.asr >= 70 ? "text-emerald-400" : "text-amber-400")}>
                            <span className="flex items-center justify-end gap-1">
                              {isLowAsr ? <TrendingDown className="w-3 h-3" /> : row.asr >= 80 ? <TrendingUp className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                              {row.asr.toFixed(2)}
                            </span>
                          </td>
                          <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium",
                            ner >= 70 ? "text-cyan-400" : ner >= 50 ? "text-sky-400" : ner >= 30 ? "text-amber-400" : "text-rose-400")}>
                            <span className="flex items-center justify-end gap-1" title={row.rnaCount != null ? `RNA: ${row.rnaCount}` : 'NER estimated from ASR'}>
                              <Wifi className="w-3 h-3 opacity-60" />
                              {ner.toFixed(2)}
                            </span>
                          </td>
                          {activeTab === 'vendor' && (
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {row.billableCalls > 0 ? (
                                <span className={cn(
                                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                  fasLevel === 'high' ? "bg-rose-500/20 text-rose-400" :
                                  fasLevel === 'med'  ? "bg-amber-500/20 text-amber-400" :
                                                        "bg-emerald-500/10 text-emerald-400/70"
                                )} title={`${fas.toFixed(1)}% of answered calls billed ≤ 5 s`}>
                                  {fasLevel === 'high' && <AlertTriangle className="w-2.5 h-2.5" />}
                                  {fas.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                          )}
                          {/* Q-Score cell — composite route quality + live trend arrow */}
                          {(() => {
                            const q      = computeQuality(row);
                            const dalert = activeTab === 'vendor' ? degradeAlertMap.get(row.caller) : undefined;
                            const deltaQ = dalert?.deltaQ;
                            const trend  = dalert?.trend;
                            return (
                              <td className="px-4 py-2.5 text-right" data-testid={`qscore-${i}`}>
                                <div className="flex flex-col items-end gap-0.5">
                                  <div className="flex items-center gap-1">
                                    {/* Trend arrow */}
                                    {trend === 'degrading' && (
                                      <span className={cn(
                                        "text-[9px] font-bold tabular-nums",
                                        dalert?.severity === 'critical' ? "text-rose-400" : "text-amber-400"
                                      )} title={`Q-Score trend: ${deltaQ}`}>
                                        ↓{Math.abs(deltaQ!)}
                                      </span>
                                    )}
                                    {trend === 'improving' && (
                                      <span className="text-[9px] font-bold tabular-nums text-emerald-400" title={`Q-Score trend: +${deltaQ}`}>
                                        ↑{deltaQ}
                                      </span>
                                    )}
                                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold tabular-nums", qualityBg(q), qualityColor(q))}>
                                      <Gauge className="w-2.5 h-2.5" />
                                      {q}
                                    </span>
                                  </div>
                                  <span className={`text-[9px] font-medium ${qualityColor(q)}`}>{qualityLabel(q)}</span>
                                </div>
                              </td>
                            );
                          })()}
                          <td className="px-4 py-2.5 text-right tabular-nums">{row.avgPdd.toFixed(2)}s</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400 font-medium">${row.revenueUsd.toFixed(4)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                      <td className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">Totals / Avg</td>
                      <td className="px-4 py-3 text-right tabular-nums">{totals.totalCalls.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{totals.billableCalls.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono">{fmtDuration(totals.billedDurationSeconds)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono">{fmtDuration(totals.acdSeconds)}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", totals.asr < highlightBelow ? "text-rose-400" : "text-emerald-400")}>{totals.asr.toFixed(2)}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums",
                        totals.nerPct >= 70 ? "text-cyan-400" : totals.nerPct >= 50 ? "text-sky-400" : "text-amber-400")}>
                        {totals.nerPct.toFixed(2)}
                      </td>
                      {activeTab === 'vendor' && (
                        <td className={cn("px-4 py-3 text-right tabular-nums text-xs",
                          totals.fasRate >= 15 ? "text-rose-400" : totals.fasRate >= 5 ? "text-amber-400" : "text-emerald-400/70")}>
                          {totals.fasRate.toFixed(1)}%
                        </td>
                      )}
                      {/* Q-Score totals cell — avg across all rows */}
                      {(() => {
                        const avgQ = displayRows.length > 0
                          ? Math.round(displayRows.reduce((s, r) => s + computeQuality(r), 0) / displayRows.length)
                          : 0;
                        return (
                          <td className="px-4 py-3 text-right">
                            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold tabular-nums", qualityBg(avgQ), qualityColor(avgQ))}>
                              <Gauge className="w-2.5 h-2.5" />
                              {avgQ} avg
                            </span>
                          </td>
                        );
                      })()}
                      <td className="px-4 py-3 text-right tabular-nums">{totals.avgPdd.toFixed(2)}s</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-400">${totals.revenueUsd.toFixed(4)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          CONNECTION TAB — per-account origination + termination stats
         ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'connection' && (
        <>
          {/* Period selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">Period:</span>
            {[15, 30, 60, 90, 180, 360].map(p => (
              <button key={p} data-testid={`conn-period-${p}`}
                onClick={() => { setConnPeriod(p); }}
                className={cn("px-3 py-1 rounded-md text-xs border transition-colors",
                  connPeriod === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted/50"
                )}>
                {p < 60 ? `${p}m` : `${p/60}h`}
              </button>
            ))}
            <button data-testid="conn-refresh" onClick={() => refetchConn()}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md text-xs border border-border/60 text-muted-foreground hover:bg-muted/50 transition-colors">
              <RefreshCw className={cn("w-3 h-3", connLoading && "animate-spin")} />
              Refresh
            </button>
          </div>

          {/* Summary KPIs */}
          {connData?.ok && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Orig Calls",    value: connData.origTotal.totalCalls.toLocaleString(), color: "text-blue-400",   icon: PhoneForwarded },
                { label: "Orig Billable", value: connData.origTotal.billableCalls.toLocaleString(), color: "text-emerald-400", icon: CheckCircle2 },
                { label: "Term Calls",    value: connData.termTotal.totalCalls.toLocaleString(), color: "text-violet-400", icon: PhoneIncoming },
                { label: "Orig ASR",      value: `${connData.origTotal.asr.toFixed(1)}%`, color: connData.origTotal.asr >= 50 ? "text-emerald-400" : "text-rose-400", icon: TrendingUp },
              ].map(stat => (
                <div key={stat.label} className="bg-card rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                    <span className="text-xs text-muted-foreground">{stat.label}</span>
                  </div>
                  <p className={`text-xl font-bold tabular-nums ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Origination table */}
          <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
            <div className="px-6 py-3 border-b border-border/50 bg-muted/20 flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold">Origination — by Client</span>
              {connData && <span className="ml-auto text-xs text-muted-foreground">{connData.clients.length} clients · last {connPeriod}m</span>}
            </div>
            {connLoading ? (
              <div className="p-6 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}</div>
            ) : !connData?.ok ? (
              <div className="py-12 text-center text-muted-foreground text-sm">{connData?.error ?? 'Failed to load connection stats'}</div>
            ) : connData.clients.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">No origination data in the last {connPeriod} minutes.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left font-semibold">Client / Account</th>
                      <th className="px-4 py-3 text-right font-semibold">Calls</th>
                      <th className="px-4 py-3 text-right font-semibold">Billable</th>
                      <th className="px-4 py-3 text-right font-semibold">Duration</th>
                      <th className="px-4 py-3 text-right font-semibold">ACD</th>
                      <th className="px-4 py-3 text-right font-semibold">ASR %</th>
                      <th className="px-4 py-3 text-right font-semibold">Avg PDD</th>
                      <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connData.clients.map((r, i) => (
                      <tr key={r.name} data-testid={`conn-client-row-${i}`}
                        className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-emerald-400/90">{r.name || 'Unknown'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.totalCalls.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.billableCalls.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(r.durationSec)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(r.acdSec)}</td>
                        <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", r.asr >= 50 ? "text-emerald-400" : "text-rose-400")}>{r.asr.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.avgPdd.toFixed(2)}s</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-amber-400">${r.amount.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold text-xs">
                      <td className="px-4 py-3 text-muted-foreground uppercase tracking-wider">Total</td>
                      <td className="px-4 py-3 text-right">{connData.origTotal.totalCalls.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{connData.origTotal.billableCalls.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtDuration(connData.origTotal.durationSec)}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtDuration(connData.origTotal.acdSec)}</td>
                      <td className={cn("px-4 py-3 text-right", connData.origTotal.asr >= 50 ? "text-emerald-400" : "text-rose-400")}>{connData.origTotal.asr.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">{connData.origTotal.avgPdd.toFixed(2)}s</td>
                      <td className="px-4 py-3 text-right text-amber-400">${connData.origTotal.amount.toFixed(4)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Termination table */}
          <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
            <div className="px-6 py-3 border-b border-border/50 bg-muted/20 flex items-center gap-2">
              <Server className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-semibold">Termination — by Vendor / Connection</span>
              {connData && <span className="ml-auto text-xs text-muted-foreground">{connData.vendors.length} connections</span>}
            </div>
            {connLoading ? (
              <div className="p-6 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}</div>
            ) : connData?.vendors && connData.vendors.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left font-semibold">Vendor / Connection</th>
                      <th className="px-4 py-3 text-right font-semibold">Calls</th>
                      <th className="px-4 py-3 text-right font-semibold">Billable</th>
                      <th className="px-4 py-3 text-right font-semibold">Duration</th>
                      <th className="px-4 py-3 text-right font-semibold">ACD</th>
                      <th className="px-4 py-3 text-right font-semibold">ASR %</th>
                      <th className="px-4 py-3 text-right font-semibold">Avg PDD</th>
                      <th className="px-4 py-3 text-right font-semibold">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connData.vendors.map((r, i) => (
                      <tr key={r.name} data-testid={`conn-vendor-row-${i}`}
                        className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-violet-400/90">{r.name || 'Unknown'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.totalCalls.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.billableCalls.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(r.durationSec)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(r.acdSec)}</td>
                        <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", r.asr >= 50 ? "text-emerald-400" : "text-rose-400")}>{r.asr.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.avgPdd.toFixed(2)}s</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-rose-400">${r.amount.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold text-xs">
                      <td className="px-4 py-3 text-muted-foreground uppercase tracking-wider">Total</td>
                      <td className="px-4 py-3 text-right">{connData.termTotal.totalCalls.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{connData.termTotal.billableCalls.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtDuration(connData.termTotal.durationSec)}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtDuration(connData.termTotal.acdSec)}</td>
                      <td className={cn("px-4 py-3 text-right", connData.termTotal.asr >= 50 ? "text-emerald-400" : "text-rose-400")}>{connData.termTotal.asr.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">{connData.termTotal.avgPdd.toFixed(2)}s</td>
                      <td className="px-4 py-3 text-right text-rose-400">${connData.termTotal.amount.toFixed(4)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground text-sm">No termination data in the last {connPeriod} minutes.</div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          REVENUE & MARGIN TAB
         ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'revenue' && (
        <>
          {/* Period selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">Last:</span>
            {[1, 7, 14, 30, 60, 90].map(d => (
              <button key={d} data-testid={`rev-days-${d}`}
                onClick={() => setRevDays(d)}
                className={cn("px-3 py-1 rounded-md text-xs border transition-colors",
                  revDays === d
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted/50"
                )}>
                {d === 1 ? '24h' : `${d}d`}
              </button>
            ))}
            <button data-testid="rev-refresh" onClick={() => refetchRev()}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md text-xs border border-border/60 text-muted-foreground hover:bg-muted/50 transition-colors">
              <RefreshCw className={cn("w-3 h-3", revLoading && "animate-spin")} />
              Refresh
            </button>
          </div>

          {/* KPI Cards */}
          {revLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : revData?.summary ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                {
                  label: "Total Revenue", value: `$${revData.summary.totalRevenue.toFixed(2)}`,
                  color: "text-emerald-400", bg: "bg-emerald-500/5 border-emerald-500/20",
                  icon: DollarSign, sub: `${revData.period.days}d period`,
                },
                {
                  label: "Total Cost", value: `$${revData.summary.totalCost.toFixed(2)}`,
                  color: "text-rose-400", bg: "bg-rose-500/5 border-rose-500/20",
                  icon: TrendingDown, sub: "Vendor cost",
                },
                {
                  label: "Profit / Margin", value: `$${revData.summary.totalProfit.toFixed(2)}`,
                  color: revData.summary.totalProfit >= 0 ? "text-emerald-400" : "text-rose-400",
                  bg: revData.summary.totalProfit >= 0 ? "bg-emerald-500/5 border-emerald-500/20" : "bg-rose-500/5 border-rose-500/20",
                  icon: revData.summary.totalProfit >= 0 ? TrendingUp : TrendingDown,
                  sub: "Revenue − Cost",
                },
                {
                  label: "Margin %", value: `${revData.summary.margin.toFixed(2)}%`,
                  color: revData.summary.margin >= 20 ? "text-emerald-400" : revData.summary.margin >= 10 ? "text-amber-400" : "text-rose-400",
                  bg: revData.summary.margin >= 20 ? "bg-emerald-500/5 border-emerald-500/20" : "bg-amber-500/5 border-amber-500/20",
                  icon: Percent,
                  sub: "Net margin",
                },
              ].map(stat => (
                <div key={stat.label} className={`rounded-xl border p-5 ${stat.bg}`} data-testid={`rev-stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground font-medium">{stat.label}</span>
                    <stat.icon className={`h-4 w-4 ${stat.color} opacity-70`} />
                  </div>
                  <p className={`text-2xl font-bold tabular-nums ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">{stat.sub}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-muted-foreground">
              <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No revenue data available. {revData && 'error' in revData ? (revData as any).message : ''}</p>
            </div>
          )}

          {/* Revenue vs Cost bar chart */}
          {!revLoading && revChartData.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="px-6 py-4 border-b border-border/50 bg-muted/20 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Revenue vs Cost — Top Clients</span>
                <span className="ml-auto text-xs text-muted-foreground">Top 10 by revenue</span>
              </div>
              <div className="p-6">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={revChartData} barGap={4}>
                    <CartesianGrid {...BSE_GRID_PROPS} />
                    <XAxis dataKey="name" {...BSE_AXIS_PROPS} tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                    <YAxis {...BSE_AXIS_PROPS} tickFormatter={v => `$${v}`} />
                    <RcTooltip
                      content={<BseTooltip formatter={(v: number, key: string) => [`$${v.toFixed(2)}`, key]} />}
                      cursor={BSE_CURSOR}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(148,163,184,0.7)', paddingTop: 8 }} />
                    <Bar dataKey="Revenue" fill="#34d399" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Cost"    fill="#f87171" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Profit"  fill="#818cf8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* By Client breakdown table */}
          {!revLoading && revData?.byClient && revData.byClient.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="px-6 py-3 border-b border-border/50 bg-muted/20 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold">Client Revenue Breakdown</span>
                <div className="ml-auto flex items-center gap-2">
                  {(['revenue', 'cost', 'margin'] as const).map(s => (
                    <button key={s} onClick={() => setRevRevSort(s)}
                      className={cn("text-xs px-2.5 py-1 rounded-md border transition-colors",
                        revRevSort === s ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground hover:border-border"
                      )}>
                      By {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left font-semibold">Client</th>
                      <th className="px-4 py-3 text-right font-semibold">Calls</th>
                      <th className="px-4 py-3 text-right font-semibold">Minutes</th>
                      <th className="px-4 py-3 text-right font-semibold">Revenue</th>
                      <th className="px-4 py-3 text-right font-semibold">Cost</th>
                      <th className="px-4 py-3 text-right font-semibold">Profit</th>
                      <th className="px-4 py-3 text-right font-semibold">Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...revData.byClient]
                      .sort((a, b) => (b[revRevSort] ?? 0) - (a[revRevSort] ?? 0))
                      .map((r, i) => {
                        const margin = r.margin ?? 0;
                        return (
                          <tr key={r.name} data-testid={`rev-client-row-${i}`}
                            className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5 font-medium text-emerald-400/90 max-w-[200px] truncate" title={r.name}>{r.name}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{(r.calls || 0).toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{fmtMins(r.minutes || 0)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400 font-medium">${(r.revenue || 0).toFixed(2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-rose-400">${(r.cost || 0).toFixed(2)}</td>
                            <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", (r.profit ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                              ${(r.profit || 0).toFixed(2)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                margin >= 20 ? "bg-emerald-500/10 text-emerald-400" :
                                margin >= 10 ? "bg-amber-500/10 text-amber-400" :
                                "bg-rose-500/10 text-rose-400"
                              )}>
                                {margin >= 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                                {margin.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold text-xs">
                      <td className="px-4 py-3 text-muted-foreground uppercase tracking-wider">Total</td>
                      <td className="px-4 py-3 text-right">{revData.byClient.reduce((s, r) => s + (r.calls || 0), 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{fmtMins(revData.byClient.reduce((s, r) => s + (r.minutes || 0), 0))}</td>
                      <td className="px-4 py-3 text-right text-emerald-400">${revData.summary.totalRevenue.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-rose-400">${revData.summary.totalCost.toFixed(2)}</td>
                      <td className={cn("px-4 py-3 text-right", revData.summary.totalProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>${revData.summary.totalProfit.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
                          revData.summary.margin >= 20 ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400")}>
                          {revData.summary.margin.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* By Vendor cost table */}
          {!revLoading && revData?.byVendor && revData.byVendor.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="px-6 py-3 border-b border-border/50 bg-muted/20 flex items-center gap-2">
                <Server className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-semibold">Vendor Cost Breakdown</span>
                {revData.vendorDataLimited && (
                  <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                    Estimated from balances
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left font-semibold">Vendor / Connection</th>
                      <th className="px-4 py-3 text-right font-semibold">Calls</th>
                      <th className="px-4 py-3 text-right font-semibold">Minutes</th>
                      <th className="px-4 py-3 text-right font-semibold">Cost</th>
                      <th className="px-4 py-3 text-right font-semibold">Cost Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revData.byVendor.map((r, i) => {
                      const share = revData.summary.totalCost > 0 ? (r.cost / revData.summary.totalCost) * 100 : 0;
                      return (
                        <tr key={r.name} data-testid={`rev-vendor-row-${i}`}
                          className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-violet-400/90 max-w-[240px] truncate" title={r.name}>{r.name}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{(r.calls || 0).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtMins(r.minutes || 0)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-rose-400 font-medium">${r.cost.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                                <div className="h-full bg-rose-500/70 rounded-full" style={{ width: `${Math.min(share, 100)}%` }} />
                              </div>
                              <span className="text-muted-foreground tabular-nums w-10 text-right">{share.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold text-xs">
                      <td className="px-4 py-3 text-muted-foreground uppercase tracking-wider">Total</td>
                      <td className="px-4 py-3 text-right">{revData.byVendor.reduce((s, r) => s + (r.calls || 0), 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{fmtMins(revData.byVendor.reduce((s, r) => s + (r.minutes || 0), 0))}</td>
                      <td className="px-4 py-3 text-right text-rose-400">${revData.summary.totalCost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
