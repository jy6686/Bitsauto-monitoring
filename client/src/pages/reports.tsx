import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  format, subMinutes, subHours, subDays, startOfDay, endOfDay,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subWeeks, subMonths,
} from "date-fns";
import {
  Download, RefreshCw, Filter, TrendingUp, TrendingDown, Minus,
  Calendar, Clock, Globe, Building2, PhoneCall, CheckCircle2, PhoneOff,
  AlertTriangle, Users,
} from "lucide-react";
import { Link } from "wouter";
import type { AsrAcdReportRow, ClientProfile } from "@shared/schema";
import { cn } from "@/lib/utils";

function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s <= 0) return "00:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function toInput(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

const PRESET_GROUPS = [
  {
    label: "Quick",
    presets: [
      { label: "Last 15 min",  fn: () => [subMinutes(new Date(), 15), new Date()] },
      { label: "Last 30 min",  fn: () => [subMinutes(new Date(), 30), new Date()] },
      { label: "Last 1 hr",    fn: () => [subHours(new Date(), 1),   new Date()] },
      { label: "Last 3 hr",    fn: () => [subHours(new Date(), 3),   new Date()] },
      { label: "Last 6 hr",    fn: () => [subHours(new Date(), 6),   new Date()] },
      { label: "Last 12 hr",   fn: () => [subHours(new Date(), 12),  new Date()] },
      { label: "Last 24 hr",   fn: () => [subHours(new Date(), 24),  new Date()] },
    ],
  },
  {
    label: "Daily",
    presets: [
      { label: "Today",       fn: () => [startOfDay(new Date()), new Date()] },
      { label: "Yesterday",   fn: () => [startOfDay(subDays(new Date(), 1)), endOfDay(subDays(new Date(), 1))] },
      { label: "Last 2 days", fn: () => [startOfDay(subDays(new Date(), 1)), new Date()] },
      { label: "Last 7 days", fn: () => [startOfDay(subDays(new Date(), 6)), new Date()] },
    ],
  },
  {
    label: "Weekly",
    presets: [
      { label: "This week",  fn: () => [startOfWeek(new Date(), { weekStartsOn: 1 }), new Date()] },
      { label: "Last week",  fn: () => [startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 })] },
    ],
  },
  {
    label: "Monthly",
    presets: [
      { label: "This month",  fn: () => [startOfMonth(new Date()), new Date()] },
      { label: "Last month",  fn: () => [startOfMonth(subMonths(new Date(), 1)), endOfMonth(subMonths(new Date(), 1))] },
    ],
  },
];

// Match a number/IP to a profile. IP match takes priority over prefix match.
function matchProfile(
  number: string,
  profiles: ClientProfile[],
  type: 'client' | 'vendor',
  ip?: string,
): ClientProfile | null {
  const candidates = profiles.filter(p => p.type === type);

  // 1. Exact IP match (highest priority)
  if (ip) {
    const ipMatch = candidates.find(p => (p as any).ipAddress && (p as any).ipAddress === ip);
    if (ipMatch) return ipMatch;
  }

  // 2. Longest CLI/CLD prefix match
  let best: ClientProfile | null = null;
  let bestLen = 0;
  for (const p of candidates) {
    if (p.prefix && number.startsWith(p.prefix) && p.prefix.length > bestLen) {
      best = p;
      bestLen = p.prefix.length;
    }
  }
  return best;
}

interface VosClientStat {
  clientId: string;
  clientName: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalMinutes: number;
  totalCost: number;
  asr: number;
}

export default function ReportsPage() {
  const now = new Date();
  const qc = useQueryClient();

  const [startTime, setStartTime] = useState(toInput(subHours(now, 3)));
  const [endTime,   setEndTime]   = useState(toInput(now));
  const [activePreset, setActivePreset] = useState("Last 3 hr");
  const [cliFilter, setCliFilter]  = useState("");
  const [cldFilter, setCldFilter]  = useState("");
  const [partyType, setPartyType]  = useState<'all' | 'client' | 'vendor'>('all');
  const [highlightBelow, setHighlightBelow] = useState(10);
  const [groupBy, setGroupBy]  = useState<'caller' | 'callee'>("caller");
  const [sortBy, setSortBy]    = useState<'totalCalls' | 'asr' | 'billableCalls' | 'revenueUsd'>("totalCalls");
  const [hideEmpty, setHideEmpty] = useState(true);

  const [applied, setApplied] = useState({
    cliFilter, cldFilter, startTime, endTime, groupBy, sortBy, hideEmpty,
  });

  const { data: profiles = [] } = useQuery<ClientProfile[]>({
    queryKey: ['/api/clients'],
  });

  // VOS3000 portal queries
  const { data: portalSession } = useQuery<{ active: boolean; username?: string }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
  });
  const { data: clientStatsData, isLoading: clientStatsLoading, refetch: refetchClientStats } = useQuery<{ clients: VosClientStat[]; error?: string }>({
    queryKey: ['/api/portal/client-stats'],
    refetchInterval: 120000,
    enabled: portalSession?.active === true,
  });

  const { data: rows = [], isLoading, dataUpdatedAt } = useQuery<AsrAcdReportRow[]>({
    queryKey: ['/api/reports/asr-acd', applied],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (applied.cliFilter)  params.set('cli',       applied.cliFilter);
      if (applied.cldFilter)  params.set('cld',       applied.cldFilter);
      if (applied.startTime)  params.set('startTime', new Date(applied.startTime).toISOString());
      if (applied.endTime)    params.set('endTime',   new Date(applied.endTime).toISOString());
      params.set('groupBy',   applied.groupBy);
      params.set('sortBy',    applied.sortBy);
      params.set('hideEmpty', String(applied.hideEmpty));
      const res = await fetch(`/api/reports/asr-acd?${params}`);
      if (!res.ok) throw new Error('Failed to fetch report');
      return res.json();
    },
  });

  // Filter rows by party type if selected
  const displayRows = useMemo(() => {
    if (partyType === 'all') return rows;
    return rows.filter(r => {
      const profileType = groupBy === 'caller' ? 'client' : 'vendor';
      const matched = matchProfile(r.caller, profiles, profileType, r.caller);
      if (partyType === 'client') return matchProfile(r.caller, profiles, 'client', r.caller) !== null;
      if (partyType === 'vendor') return matchProfile(r.caller, profiles, 'vendor', r.caller) !== null;
      return true;
    });
  }, [rows, partyType, profiles, groupBy]);

  function applyFilters() {
    setApplied({ cliFilter, cldFilter, startTime, endTime, groupBy, sortBy, hideEmpty });
  }

  function applyPreset(label: string, fn: () => [Date, Date]) {
    const [start, end] = fn();
    setStartTime(toInput(start));
    setEndTime(toInput(end));
    setActivePreset(label);
    // Auto-apply immediately
    setApplied(prev => ({
      ...prev,
      startTime: toInput(start),
      endTime:   toInput(end),
    }));
  }

  function downloadCsv() {
    const headers = ['Caller/Callee', 'Profile Name', 'Type', 'Total Calls', 'Billable Calls', 'Billed Duration', 'ACD mm:ss', 'ASR %', 'Avg PDD sec', 'Revenue USD'];
    const csvRows = displayRows.map(r => {
      const matched = matchProfile(r.caller, profiles, groupBy === 'caller' ? 'client' : 'vendor', r.caller);
      return [
        r.caller,
        matched?.name || '',
        matched?.type || '',
        r.totalCalls,
        r.billableCalls,
        fmtDuration(r.billedDurationSeconds),
        fmtDuration(r.acdSeconds),
        r.asr.toFixed(4),
        r.avgPdd.toFixed(3),
        r.revenueUsd.toFixed(4),
      ].join(',');
    });
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asr_acd_report_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totals = useMemo(() => ({
    totalCalls: displayRows.reduce((s, r) => s + r.totalCalls, 0),
    billableCalls: displayRows.reduce((s, r) => s + r.billableCalls, 0),
    billedDurationSeconds: displayRows.reduce((s, r) => s + r.billedDurationSeconds, 0),
    revenueUsd: displayRows.reduce((s, r) => s + r.revenueUsd, 0),
    asr: displayRows.length > 0 ? displayRows.reduce((s, r) => s + r.asr, 0) / displayRows.length : 0,
    acdSeconds: displayRows.length > 0 ? displayRows.reduce((s, r) => s + r.acdSeconds, 0) / displayRows.length : 0,
    avgPdd: displayRows.length > 0 ? displayRows.reduce((s, r) => s + r.avgPdd, 0) / displayRows.length : 0,
  }), [displayRows]);

  const rangeLabel = `${format(new Date(startTime), 'd MMM HH:mm')} → ${format(new Date(endTime), 'd MMM HH:mm')}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">ASR / ACD Reports</h2>
          <p className="text-muted-foreground mt-1 text-sm flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {rangeLabel}
            {dataUpdatedAt > 0 && (
              <span className="text-muted-foreground/50 ml-2">· Updated {format(new Date(dataUpdatedAt), 'HH:mm:ss')}</span>
            )}
          </p>
        </div>
        <button
          data-testid="button-download-csv"
          onClick={downloadCsv}
          disabled={displayRows.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Filter Panel */}
      <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border/50 bg-muted/20">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters & Time Range</span>
        </div>
        <div className="p-5 space-y-5">

          {/* ── Date/Time Range ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time Range</span>
            </div>

            {/* Preset groups */}
            <div className="space-y-2 mb-4">
              {PRESET_GROUPS.map(group => (
                <div key={group.label} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground/60 w-14 flex-shrink-0">{group.label}</span>
                  {group.presets.map(p => (
                    <button
                      key={p.label}
                      data-testid={`preset-${p.label.replace(/\s/g, '-').toLowerCase()}`}
                      onClick={() => applyPreset(p.label, p.fn as any)}
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

            {/* Custom date inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground uppercase tracking-wider">From</label>
                <input
                  data-testid="input-start-time"
                  type="datetime-local"
                  value={startTime}
                  onChange={e => { setStartTime(e.target.value); setActivePreset(''); }}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground uppercase tracking-wider">To</label>
                <input
                  data-testid="input-end-time"
                  type="datetime-local"
                  value={endTime}
                  onChange={e => { setEndTime(e.target.value); setActivePreset(''); }}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border/40 pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* CLI filter */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">CLI (Caller)</label>
              <input
                data-testid="input-cli-filter"
                value={cliFilter}
                onChange={e => setCliFilter(e.target.value)}
                placeholder="e.g. +1212"
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            {/* CLD filter */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">CLD (Destination)</label>
              <input
                data-testid="input-cld-filter"
                value={cldFilter}
                onChange={e => setCldFilter(e.target.value)}
                placeholder="e.g. +44"
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            {/* Party type */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Show Party</label>
              <select
                data-testid="select-party-type"
                value={partyType}
                onChange={e => setPartyType(e.target.value as any)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="all">All parties</option>
                <option value="client">Clients only</option>
                <option value="vendor">Vendors only</option>
              </select>
            </div>

            {/* Group by */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Group By</label>
              <select
                data-testid="select-group-by"
                value={groupBy}
                onChange={e => setGroupBy(e.target.value as any)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="caller">Caller / CLI</option>
                <option value="callee">Callee / CLD</option>
              </select>
            </div>

            {/* Sort */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Sort By</label>
              <select
                data-testid="select-sort-by"
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="totalCalls">Number of Calls</option>
                <option value="billableCalls">Billable Calls</option>
                <option value="asr">ASR %</option>
                <option value="revenueUsd">Revenue</option>
              </select>
            </div>

            {/* Highlight ASR */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Highlight ASR below %</label>
              <input
                data-testid="input-highlight-asr"
                type="number"
                value={highlightBelow}
                onChange={e => setHighlightBelow(Number(e.target.value))}
                min={0} max={100}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            {/* Hide empty */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Hide Entries w/o Calls</label>
              <div className="flex items-center h-9 gap-2">
                <input
                  data-testid="checkbox-hide-empty"
                  type="checkbox"
                  checked={hideEmpty}
                  onChange={e => setHideEmpty(e.target.checked)}
                  className="w-4 h-4 rounded accent-primary"
                />
                <span className="text-sm text-muted-foreground">{hideEmpty ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          {/* Apply button */}
          <div className="flex gap-3 pt-1">
            <button
              data-testid="button-update-report"
              onClick={applyFilters}
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
              Update Report
            </button>
          </div>
        </div>
      </div>

      {/* ── VOS3000 Portal Client Stats ─────────────────────────── */}
      <div className="rounded-xl border overflow-hidden bg-card/60 shadow-sm"
           style={{ borderColor: portalSession?.active ? 'rgb(139 92 246 / 0.3)' : undefined }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-3">
            <Globe className={`w-4 h-4 ${portalSession?.active ? 'text-violet-400' : 'text-muted-foreground'}`} />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">VOS3000 Client Stats</h3>
                {portalSession?.active ? (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                    Live · Last 24h
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                    Not Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {portalSession?.active
                  ? `Per-client traffic stats from VOS3000 — last 24 hours`
                  : 'Connect to VOS3000 in Settings to see per-client traffic data here'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {portalSession?.active && (
              <button
                data-testid="button-refresh-client-stats"
                onClick={() => refetchClientStats()}
                disabled={clientStatsLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${clientStatsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
            {!portalSession?.active && (
              <Link href="/settings"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                Connect
              </Link>
            )}
          </div>
        </div>

        {!portalSession?.active ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3 text-muted-foreground">
            <Users className="w-8 h-8 opacity-30" />
            <p className="text-sm">Connect to VOS3000 to see client-by-client traffic breakdown.</p>
          </div>
        ) : clientStatsLoading ? (
          <div className="flex items-center justify-center py-14 gap-2 text-muted-foreground text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Fetching client stats from portal…
          </div>
        ) : clientStatsData?.error ? (
          <div className="flex items-center justify-center py-10 gap-2 text-amber-400 text-sm">
            <AlertTriangle className="w-4 h-4" />
            {clientStatsData.error}
          </div>
        ) : !clientStatsData?.clients?.length ? (
          <div className="flex flex-col items-center justify-center py-14 gap-2 text-muted-foreground text-sm">
            <Users className="w-7 h-7 opacity-30" />
            <p>No client traffic data returned for the last 24 hours.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left font-semibold">Client Name</th>
                  <th className="px-4 py-3 text-right font-semibold">Total Calls</th>
                  <th className="px-4 py-3 text-right font-semibold">Answered</th>
                  <th className="px-4 py-3 text-right font-semibold">Failed</th>
                  <th className="px-4 py-3 text-right font-semibold">Minutes</th>
                  <th className="px-4 py-3 text-right font-semibold">ASR %</th>
                  <th className="px-4 py-3 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {clientStatsData.clients.map((c, i) => (
                  <tr key={c.clientId || i}
                      data-testid={`row-client-stat-${i}`}
                      className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
                        <span className="font-medium text-sm">{c.clientName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.totalCalls.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">{c.successCalls.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-rose-400">{c.failedCalls.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-violet-400">{c.totalMinutes.toLocaleString()}</td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold",
                      c.asr >= 70 ? 'text-emerald-400' : c.asr >= 50 ? 'text-amber-400' : 'text-rose-400')}>
                      <span className="flex items-center justify-end gap-1">
                        {c.asr >= 70 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {c.asr.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {c.totalCost > 0 ? `$${c.totalCost.toFixed(4)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
                    Totals — {clientStatsData.clients.length} clients
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {clientStatsData.clients.reduce((s, c) => s + c.totalCalls, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-400">
                    {clientStatsData.clients.reduce((s, c) => s + c.successCalls, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-rose-400">
                    {clientStatsData.clients.reduce((s, c) => s + c.failedCalls, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-violet-400">
                    {clientStatsData.clients.reduce((s, c) => s + c.totalMinutes, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-400">
                    {(clientStatsData.clients.reduce((s, c) => s + c.asr, 0) / clientStatsData.clients.length).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    ${clientStatsData.clients.reduce((s, c) => s + c.totalCost, 0).toFixed(4)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
        <div className="px-6 py-3 border-b border-border/50 bg-muted/20 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold">ASR / ACD Origination Report</span>
          <span className="text-xs text-muted-foreground">
            {displayRows.length} parties · {totals.totalCalls.toLocaleString()} calls
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Generating report…
          </div>
        ) : displayRows.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">
            No data found for the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left font-semibold">
                    {groupBy === 'caller' ? 'Client / CLI' : 'Vendor / CLD'}
                  </th>
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
                  return (
                    <tr
                      key={row.caller}
                      data-testid={`row-report-${i}`}
                      className={cn(
                        "border-b border-border/30 transition-colors hover:bg-muted/20",
                        isLowAsr ? "bg-rose-500/5" : ""
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col">
                          {matched && (
                            <span className={cn("text-xs font-semibold", matched.type === 'client' ? 'text-emerald-400' : 'text-violet-400')}>
                              {matched.name}
                            </span>
                          )}
                          <span className={cn("font-mono text-xs", isLowAsr ? "text-rose-400" : "text-blue-400")}>
                            {row.caller}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.totalCalls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.billableCalls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(row.billedDurationSeconds)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(row.acdSeconds)}</td>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", isLowAsr ? "text-rose-400" : row.asr >= 70 ? "text-emerald-400" : "text-amber-400")}>
                        <span className="flex items-center justify-end gap-1">
                          {isLowAsr
                            ? <TrendingDown className="w-3 h-3" />
                            : row.asr >= 80 ? <TrendingUp className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                          {row.asr.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.avgPdd.toFixed(2)}s</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400 font-medium">
                        ${row.revenueUsd.toFixed(4)}
                      </td>
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
                  <td className={cn("px-4 py-3 text-right tabular-nums", totals.asr < highlightBelow ? "text-rose-400" : "text-emerald-400")}>
                    {totals.asr.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.avgPdd.toFixed(2)}s</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-400">${totals.revenueUsd.toFixed(4)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
