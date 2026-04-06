import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subMinutes, subHours } from "date-fns";
import { Download, RefreshCw, Filter, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { AsrAcdReportRow } from "@shared/schema";
import { cn } from "@/lib/utils";

// Format seconds → mm:ss or h:mm:ss
function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s <= 0) return "00:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Quick preset time windows
const PRESETS = [
  { label: "Last 30 min", value: () => subMinutes(new Date(), 30) },
  { label: "Last 1 hr",   value: () => subHours(new Date(), 1) },
  { label: "Last 3 hr",   value: () => subHours(new Date(), 3) },
  { label: "Last 6 hr",   value: () => subHours(new Date(), 6) },
  { label: "Last 24 hr",  value: () => subHours(new Date(), 24) },
  { label: "Today",       value: () => { const d = new Date(); d.setHours(0,0,0,0); return d; } },
];

function toInputValue(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export default function ReportsPage() {
  const now = new Date();
  const defaultStart = subMinutes(now, 90);

  const [cliFilter, setCliFilter] = useState("");
  const [cldFilter, setCldFilter] = useState("");
  const [startTime, setStartTime] = useState(toInputValue(defaultStart));
  const [endTime, setEndTime]     = useState(toInputValue(now));
  const [highlightBelow, setHighlightBelow] = useState(10);
  const [groupBy, setGroupBy]     = useState<'caller' | 'callee'>("caller");
  const [sortBy, setSortBy]       = useState<'totalCalls' | 'asr' | 'billableCalls' | 'revenueUsd'>("totalCalls");
  const [hideEmpty, setHideEmpty] = useState(true);

  // Applied (committed) filters — only change when "Update Report" is clicked
  const [applied, setApplied] = useState({
    cliFilter, cldFilter, startTime, endTime, groupBy, sortBy, hideEmpty,
  });

  const { data: rows = [], isLoading, refetch, dataUpdatedAt } = useQuery<AsrAcdReportRow[]>({
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

  function applyFilters() {
    setApplied({ cliFilter, cldFilter, startTime, endTime, groupBy, sortBy, hideEmpty });
  }

  function applyPreset(presetFn: () => Date) {
    const start = presetFn();
    setStartTime(toInputValue(start));
    setEndTime(toInputValue(new Date()));
  }

  // CSV Export
  function downloadCsv() {
    const headers = ['Caller','Total Calls','Billable Calls','Billed Duration','ACD mm:ss','ASR %','Avg PDD sec','Revenue USD'];
    const csvRows = rows.map(r => [
      r.caller,
      r.totalCalls,
      r.billableCalls,
      fmtDuration(r.billedDurationSeconds),
      fmtDuration(r.acdSeconds),
      r.asr.toFixed(4),
      r.avgPdd.toFixed(7),
      r.revenueUsd.toFixed(7),
    ].join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asr_acd_report_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Totals row
  const totals = useMemo(() => ({
    totalCalls: rows.reduce((s, r) => s + r.totalCalls, 0),
    billableCalls: rows.reduce((s, r) => s + r.billableCalls, 0),
    billedDurationSeconds: rows.reduce((s, r) => s + r.billedDurationSeconds, 0),
    revenueUsd: rows.reduce((s, r) => s + r.revenueUsd, 0),
    asr: rows.length > 0
      ? rows.reduce((s, r) => s + r.asr, 0) / rows.length
      : 0,
    acdSeconds: rows.length > 0
      ? rows.reduce((s, r) => s + r.acdSeconds, 0) / rows.length
      : 0,
    avgPdd: rows.length > 0
      ? rows.reduce((s, r) => s + r.avgPdd, 0) / rows.length
      : 0,
  }), [rows]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">ASR / ACD Reports</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Per-client origination breakdown — {format(new Date(), "d MMM yyyy HH:mm:ss")} (UTC)
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          {dataUpdatedAt > 0 && (
            <span>Last updated: {format(new Date(dataUpdatedAt), 'HH:mm:ss')}</span>
          )}
        </div>
      </div>

      {/* Filter Panel */}
      <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border/50 bg-muted/20">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filter</span>
        </div>
        <div className="p-6 space-y-4">
          {/* Row 1 — CLI / CLD */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">CLI</label>
              <div className="flex gap-2 items-center">
                <span className="text-xs text-muted-foreground whitespace-nowrap">is like</span>
                <input
                  data-testid="input-cli-filter"
                  value={cliFilter}
                  onChange={e => setCliFilter(e.target.value)}
                  placeholder="e.g. +1212"
                  className="flex-1 h-8 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">CLD</label>
              <div className="flex gap-2 items-center">
                <span className="text-xs text-muted-foreground whitespace-nowrap">is like</span>
                <input
                  data-testid="input-cld-filter"
                  value={cldFilter}
                  onChange={e => setCldFilter(e.target.value)}
                  placeholder="e.g. +44"
                  className="flex-1 h-8 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Start Date/Time</label>
              <input
                data-testid="input-start-time"
                type="datetime-local"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full h-8 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">End Date/Time</label>
              <input
                data-testid="input-end-time"
                type="datetime-local"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full h-8 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.value)}
                className="px-3 py-1 rounded-md text-xs border border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Row 2 — Options */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Highlight ASR below %</label>
              <input
                data-testid="input-highlight-asr"
                type="number"
                value={highlightBelow}
                onChange={e => setHighlightBelow(Number(e.target.value))}
                min={0} max={100} step={1}
                className="w-full h-8 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Origination Group by</label>
              <select
                data-testid="select-group-by"
                value={groupBy}
                onChange={e => setGroupBy(e.target.value as 'caller' | 'callee')}
                className="w-full h-8 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="caller">Caller (CLI)</option>
                <option value="callee">Callee (CLD)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Sort by</label>
              <select
                data-testid="select-sort-by"
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="w-full h-8 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="totalCalls">Number of Calls</option>
                <option value="billableCalls">Billable Calls</option>
                <option value="asr">ASR %</option>
                <option value="revenueUsd">Revenue</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Hide Entries w/o Calls</label>
              <div className="flex items-center h-8 gap-2">
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

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <button
              data-testid="button-update-report"
              onClick={applyFilters}
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
              Update Report
            </button>
            <button
              data-testid="button-download-csv"
              onClick={downloadCsv}
              disabled={rows.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          </div>
        </div>
      </div>

      {/* Report Table */}
      <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
        {/* Table title bar */}
        <div className="px-6 py-3 border-b border-border/50 bg-muted/20 flex items-center justify-between">
          <span className="text-sm font-semibold">ASR/ACD Report — Origination</span>
          <span className="text-xs text-muted-foreground">{rows.length} callers · {totals.totalCalls.toLocaleString()} total calls</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Generating report…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">
            No data found for the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left font-semibold">Caller</th>
                  <th className="px-4 py-3 text-right font-semibold">Number of Calls</th>
                  <th className="px-4 py-3 text-right font-semibold">Billable Calls</th>
                  <th className="px-4 py-3 text-right font-semibold">Billed Duration, mm:ss</th>
                  <th className="px-4 py-3 text-right font-semibold">ACD, mm:ss</th>
                  <th className="px-4 py-3 text-right font-semibold">ASR, %</th>
                  <th className="px-4 py-3 text-right font-semibold">Average PDD, sec</th>
                  <th className="px-4 py-3 text-right font-semibold">Revenue, USD</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isLowAsr = row.asr < highlightBelow;
                  return (
                    <tr
                      key={row.caller}
                      data-testid={`row-report-${i}`}
                      className={cn(
                        "border-b border-border/30 transition-colors hover:bg-muted/20",
                        isLowAsr ? "bg-rose-500/8 hover:bg-rose-500/12" : ""
                      )}
                    >
                      <td className={cn("px-4 py-2.5 font-mono text-xs font-medium", isLowAsr ? "text-rose-400" : "text-blue-400 hover:underline cursor-pointer")}>
                        {row.caller}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.totalCalls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.billableCalls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(row.billedDurationSeconds)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-mono">{fmtDuration(row.acdSeconds)}</td>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", isLowAsr ? "text-rose-400" : row.asr >= 70 ? "text-emerald-400" : "text-amber-400")}>
                        <span className="flex items-center justify-end gap-1">
                          {isLowAsr
                            ? <TrendingDown className="w-3 h-3" />
                            : row.asr >= 80
                            ? <TrendingUp className="w-3 h-3" />
                            : <Minus className="w-3 h-3" />}
                          {row.asr.toFixed(4)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.avgPdd.toFixed(7)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400 font-medium">
                        {row.revenueUsd.toFixed(7)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold text-foreground">
                  <td className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">Totals / Avg</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.totalCalls.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.billableCalls.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-mono">{fmtDuration(totals.billedDurationSeconds)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-mono">{fmtDuration(totals.acdSeconds)}</td>
                  <td className={cn("px-4 py-3 text-right tabular-nums", totals.asr < highlightBelow ? "text-rose-400" : "text-emerald-400")}>
                    {totals.asr.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.avgPdd.toFixed(7)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-400">{totals.revenueUsd.toFixed(7)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
