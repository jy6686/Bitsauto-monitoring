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
  AlertTriangle, Users, DollarSign, ShieldAlert, Flag, ArrowRight,
  PhoneForwarded, PhoneIncoming, Activity, BarChart2, Layers, Server,
  Percent, ArrowUpRight, ArrowDownRight, Wifi,
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

type ReportRow = AsrAcdReportRow & { clientName?: string; country?: string };

type ActiveTab = 'client' | 'vendor' | 'connection' | 'revenue' | 'anomalies';

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
  { id: 'client',     label: 'Client Report',    icon: Users,       desc: 'Origination analytics by customer / CLI' },
  { id: 'vendor',     label: 'Vendor Report',    icon: Server,      desc: 'Termination analytics by vendor / connection' },
  { id: 'connection', label: 'Connection',       icon: Layers,      desc: 'Per-account stats · origination + termination' },
  { id: 'revenue',    label: 'Revenue & Margin', icon: DollarSign,  desc: 'P&L summary · margin analytics' },
  { id: 'anomalies',  label: 'CDR Anomalies',    icon: ShieldAlert, desc: 'Statistical per-account deviation detection' },
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
  const [sortBy, setSortBy]    = useState<'totalCalls' | 'asr' | 'billableCalls' | 'revenueUsd'>("totalCalls");
  const [hideEmpty, setHideEmpty] = useState(true);

  const [applied, setApplied] = useState({ cliFilter, cldFilter, startTime, endTime, sortBy, hideEmpty, tz });

  // ── Connection tab ──────────────────────────────────────────────────────────
  const [connPeriod, setConnPeriod] = useState(90);

  // ── Revenue tab ─────────────────────────────────────────────────────────────
  const [revDays, setRevDays] = useState(7);
  const [revRevSort, setRevRevSort] = useState<'revenue' | 'cost' | 'margin'>('revenue');

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
      params.set('sortBy',    applied.sortBy);
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
    if (partyType === 'all') return rows;
    return rows.filter(() => {
      if (partyType === 'client') return true;
      if (partyType === 'vendor') return true;
      return true;
    });
  }, [rows, partyType]);

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

  // ── CDR Anomaly query ────────────────────────────────────────────────────────
  type AnomalyRow = {
    account: string; metric: string; label: string;
    baseline: number; observed: number; sigma: number;
    severity: string; direction: string;
  };
  const { data: anomalyData, isLoading: anomalyLoading, refetch: refetchAnomalies } = useQuery<{
    anomalies: AnomalyRow[]; accountsAnalysed: number; baselineAccounts: number; windowHours: number;
  }>({
    queryKey: ['/api/cdr-anomalies'],
    enabled: activeTab === 'anomalies',
    staleTime: 120_000,
  });

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totals = useMemo(() => ({
    totalCalls: displayRows.reduce((s, r) => s + r.totalCalls, 0),
    billableCalls: displayRows.reduce((s, r) => s + r.billableCalls, 0),
    billedDurationSeconds: displayRows.reduce((s, r) => s + r.billedDurationSeconds, 0),
    revenueUsd: displayRows.reduce((s, r) => s + r.revenueUsd, 0),
    asr: displayRows.length > 0 ? displayRows.reduce((s, r) => s + r.asr, 0) / displayRows.length : 0,
    acdSeconds: displayRows.length > 0 ? displayRows.reduce((s, r) => s + r.acdSeconds, 0) / displayRows.length : 0,
    avgPdd: displayRows.length > 0 ? displayRows.reduce((s, r) => s + r.avgPdd, 0) / displayRows.length : 0,
  }), [displayRows]);

  function applyFilters() { setApplied({ cliFilter, cldFilter, startTime, endTime, sortBy, hideEmpty, tz }); }
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Calls",    value: totals.totalCalls.toLocaleString(), color: "text-blue-400",   icon: PhoneCall },
                { label: "Billable Calls", value: totals.billableCalls.toLocaleString(), color: "text-emerald-400", icon: CheckCircle2 },
                { label: "Avg ASR",        value: `${totals.asr.toFixed(2)}%`, color: totals.asr >= 50 ? "text-emerald-400" : "text-rose-400", icon: TrendingUp },
                { label: "Revenue (USD)",  value: `$${totals.revenueUsd.toFixed(2)}`, color: "text-amber-400", icon: DollarSign },
              ].map(stat => (
                <div key={stat.label} className="bg-card rounded-xl border border-border p-4" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
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

      {/* ════════════════════════════════════════════════════════════════════════
          ANOMALIES TAB — statistical CDR per-account deviation detector
         ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'anomalies' && (
        <>
          {/* Sub-header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Statistical σ-deviation over {anomalyData?.windowHours ?? 72}h CDR rolling window ·&nbsp;
              {anomalyData?.accountsAnalysed ?? 0} accounts analysed ·&nbsp;
              {anomalyData?.baselineAccounts ?? 0} with baseline data
            </div>
            <button
              onClick={() => refetchAnomalies()}
              disabled={anomalyLoading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 text-xs hover:bg-muted/30 transition-colors disabled:opacity-50"
              data-testid="btn-refresh-anomalies"
            >
              {anomalyLoading ? <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              Re-run Detection
            </button>
          </div>

          {/* KPI strip */}
          {anomalyData && (
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  label: 'Critical',
                  count: anomalyData.anomalies.filter(a => a.severity === 'critical').length,
                  color: 'text-red-400',
                  bg:    'bg-red-500/10 border-red-500/30',
                },
                {
                  label: 'High',
                  count: anomalyData.anomalies.filter(a => a.severity === 'high').length,
                  color: 'text-amber-400',
                  bg:    'bg-amber-500/10 border-amber-500/30',
                },
                {
                  label: 'Medium',
                  count: anomalyData.anomalies.filter(a => a.severity === 'medium').length,
                  color: 'text-yellow-400',
                  bg:    'bg-yellow-500/10 border-yellow-500/30',
                },
              ].map(k => (
                <div key={k.label} className={`rounded-xl border p-4 ${k.bg}`}>
                  <div className={`text-3xl font-bold font-mono ${k.color}`}>{k.count}</div>
                  <div className="text-xs text-muted-foreground mt-1">{k.label} severity anomalies</div>
                </div>
              ))}
            </div>
          )}

          {/* Anomaly table */}
          <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
            {anomalyLoading ? (
              <div className="p-8 flex flex-col gap-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : !anomalyData || anomalyData.anomalies.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground/50">
                <ShieldAlert className="w-10 h-10 opacity-30" />
                <div className="text-sm text-center">
                  {anomalyData?.accountsAnalysed === 0
                    ? 'No CDR data in cache. Ensure Sippy is connected and CDRs are flowing.'
                    : 'No statistical anomalies detected in the current 72h window.'}
                </div>
                {anomalyData && anomalyData.accountsAnalysed > 0 && (
                  <div className="text-xs text-muted-foreground/40 text-center max-w-xs">
                    {anomalyData.baselineAccounts} of {anomalyData.accountsAnalysed} accounts have enough baseline data (≥5 answered calls).
                    Anomalies are flagged at ≥2σ deviation.
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-border/50 bg-muted/20">
                    <tr>
                      <th className="px-4 py-3 text-left text-muted-foreground font-medium">Severity</th>
                      <th className="px-4 py-3 text-left text-muted-foreground font-medium">Account</th>
                      <th className="px-4 py-3 text-left text-muted-foreground font-medium">Metric</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Baseline</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Observed</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Deviation (σ)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anomalyData.anomalies.map((row, i) => {
                      const sevColor = row.severity === 'critical' ? 'text-red-400 bg-red-500/10 border-red-500/40'
                        : row.severity === 'high'    ? 'text-amber-400 bg-amber-500/10 border-amber-500/40'
                        : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/40';

                      const fmtVal = (metric: string, val: number) => {
                        if (metric === 'avg_duration') return `${val.toFixed(0)}s`;
                        if (metric === 'cost_per_min') return `$${val.toFixed(4)}/min`;
                        if (metric === 'dest_entropy') return val.toFixed(3);
                        return val.toFixed(3);
                      };

                      return (
                        <tr key={i} className="border-b border-border/20 hover:bg-muted/20 transition-colors" data-testid={`anomaly-row-${i}`}>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${sevColor}`}>
                              {row.severity}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono font-medium">{row.account}</td>
                          <td className="px-4 py-3 text-muted-foreground">{row.label}</td>
                          <td className="px-4 py-3 text-right font-mono text-muted-foreground">{fmtVal(row.metric, row.baseline)}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold">
                            <span className={row.direction === 'up' ? 'text-amber-400' : 'text-blue-400'}>
                              {fmtVal(row.metric, row.observed)}
                              <span className="text-[9px] ml-1 opacity-70">{row.direction === 'up' ? '▲' : '▼'}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <span className={row.sigma >= 3 ? 'text-red-400' : row.sigma >= 2.5 ? 'text-amber-400' : 'text-yellow-400'}>
                              {row.sigma.toFixed(2)}σ
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Explanation card */}
          <div className="rounded-xl border border-border/30 bg-muted/10 p-5 text-xs text-muted-foreground space-y-1.5">
            <div className="font-medium text-foreground/80 mb-2">How anomaly detection works</div>
            <div><span className="text-foreground/70">Window:</span> Compares each account's last 24h CDR data against the 24–72h baseline window.</div>
            <div><span className="text-foreground/70">Metrics:</span> Avg call duration · Cost per minute · Destination diversity (Shannon entropy).</div>
            <div><span className="text-foreground/70">Thresholds:</span> Medium ≥ 2σ · High ≥ 2.5σ · Critical ≥ 3σ from baseline mean.</div>
            <div><span className="text-foreground/70">Requires:</span> ≥ 5 answered calls in the baseline window per account.</div>
          </div>
        </>
      )}
    </div>
  );
}
