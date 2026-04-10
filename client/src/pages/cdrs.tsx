import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  formatUTC, toUTCDateInput,
  subMinutesUTC, subHoursUTC, subDaysUTC, subWeeksUTC, subMonthsUTC,
  startOfDayUTC, endOfDayUTC, startOfWeekUTC, endOfWeekUTC,
  startOfMonthUTC, endOfMonthUTC,
} from "@/lib/date-utils";
import {
  RefreshCw, Download, Phone, PhoneOff, PhoneMissed,
  ChevronLeft, ChevronRight, Filter, Search, X, Clock,
  DollarSign, Globe, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function toInput(d: Date): string {
  return toUTCDateInput(d);
}

function fmtDurSec(seconds: number): string {
  const s = Math.round(seconds || 0);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function parseSippyRawDate(raw: string): Date | null {
  if (!raw || raw === '-') return null;
  // ISO 8601 — already standard, e.g. "2026-04-10T19:22:56.000Z"
  let d = new Date(raw);
  if (!isNaN(d.getTime())) return d;
  // Sippy compact ISO: "20260410T19:22:56"
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (compact) {
    d = new Date(`${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`);
    if (!isNaN(d.getTime())) return d;
  }
  // Sippy legacy GMT: "19:22:56.000 GMT Fri Apr 10 2026"
  const legacy = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s+GMT\s+\w+\s+(\w+)\s+(\d+)\s+(\d{4})/.exec(raw.trim());
  if (legacy) {
    const months: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    const mo = months[legacy[4]];
    if (mo !== undefined) {
      d = new Date(Date.UTC(+legacy[6], mo, +legacy[5], +legacy[1], +legacy[2], +legacy[3]));
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function fmtSetupTime(raw: string): string {
  if (!raw || raw === '-') return '-';
  const d = parseSippyRawDate(raw);
  if (d) return formatUTC(d, 'dd MMM yyyy HH:mm:ss');
  return raw;
}

function fmtCurrency(val: number): string {
  return (val || 0).toFixed(7);
}

const PRESETS = [
  { label: "Last 15 min",  fn: () => [subMinutesUTC(new Date(), 15), new Date()] },
  { label: "Last 1 hr",    fn: () => [subHoursUTC(new Date(), 1),    new Date()] },
  { label: "Last 6 hr",    fn: () => [subHoursUTC(new Date(), 6),    new Date()] },
  { label: "Last 24 hr",   fn: () => [subHoursUTC(new Date(), 24),   new Date()] },
  { label: "Today",        fn: () => [startOfDayUTC(new Date()),      new Date()] },
  { label: "Yesterday",    fn: () => [startOfDayUTC(subDaysUTC(new Date(), 1)), endOfDayUTC(subDaysUTC(new Date(), 1))] },
  { label: "Last 7 days",  fn: () => [startOfDayUTC(subDaysUTC(new Date(), 6)), new Date()] },
  { label: "This week",    fn: () => [startOfWeekUTC(new Date()), new Date()] },
  { label: "Last week",    fn: () => [startOfWeekUTC(subWeeksUTC(new Date(), 1)), endOfWeekUTC(subWeeksUTC(new Date(), 1))] },
  { label: "This month",   fn: () => [startOfMonthUTC(new Date()),   new Date()] },
  { label: "Last month",   fn: () => [startOfMonthUTC(subMonthsUTC(new Date(), 1)), endOfMonthUTC(subMonthsUTC(new Date(), 1))] },
];

const CALL_TYPE_OPTIONS = [
  { value: 'non_zero',          label: 'Answered / Billed' },
  { value: 'all',               label: 'All Calls' },
  { value: 'complete',          label: 'Completed Only' },
  { value: 'non_zero_and_errors', label: 'Answered + Errors' },
  { value: 'incomplete',        label: 'Incomplete / Unanswered' },
  { value: 'errors',            label: 'Errors Only' },
];

type CdrStatus = 'answered' | 'sip-error' | 'cancelled' | 'incomplete' | 'unknown';

function getCdrStatus(cdr: any): CdrStatus {
  const result = (cdr.result || '').toString().toLowerCase();
  const duration = cdr.duration || cdr.totalDuration || 0;
  if (duration > 0) return 'answered';
  if (/\b(404|486|488|503|5\d\d)\b/.test(result) || /sip[_\s]?error/i.test(result)) return 'sip-error';
  if (/\b4\d\d\b/.test(result) && !/answered|ok|200/i.test(result)) return 'sip-error';
  if (/cancel|busy|decline|rejected|no.answer/i.test(result)) return 'cancelled';
  if (/incomplete|timeout|address.*incomplete/i.test(result)) return 'incomplete';
  if (!result || result === '-') return 'incomplete';
  return 'unknown';
}

function StatusIcon({ cdr }: { cdr: any }) {
  const status = getCdrStatus(cdr);
  const result = cdr.result || '';
  const title = result || 'Unknown';

  if (status === 'answered') {
    return (
      <span title="Answered" className="flex items-center justify-center">
        <Phone className="h-3.5 w-3.5 text-emerald-400" />
      </span>
    );
  }
  if (status === 'sip-error') {
    return (
      <span title={`SIP Error: ${title}`} className="flex items-center justify-center">
        <span className="h-3 w-3 rounded-full bg-red-500 inline-block" />
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span title={title} className="flex items-center justify-center">
        <PhoneMissed className="h-3.5 w-3.5 text-amber-400" />
      </span>
    );
  }
  return (
    <span title={title} className="flex items-center justify-center">
      <span className="h-3 w-3 rounded-full bg-amber-500/60 inline-block" />
    </span>
  );
}

const PAGE_SIZE = 50;

export default function CDRsPage() {
  const defaultStart = subHours(new Date(), 24);
  const defaultEnd   = new Date();
  const [start, setStart]       = useState(defaultStart);
  const [end,   setEnd]         = useState(defaultEnd);
  const [startInput, setStartInput] = useState(toInput(defaultStart));
  const [endInput,   setEndInput]   = useState(toInput(defaultEnd));
  const [callType,  setCallType]    = useState('non_zero');
  const [cli,       setCli]         = useState('');
  const [cld,       setCld]         = useState('');
  const [page,      setPage]        = useState(0);
  const [applied,   setApplied]     = useState({
    start: defaultStart, end: defaultEnd, callType: 'non_zero', cli: '', cld: '',
  });

  const offset = page * PAGE_SIZE;

  const queryKey = [
    '/api/sippy/cdr',
    applied.start.toISOString(),
    applied.end.toISOString(),
    applied.callType,
    applied.cli,
    applied.cld,
    offset,
  ];

  const buildUrl = (a: typeof applied, off: number) => {
    const params = new URLSearchParams({
      startDate: a.start.toISOString(),
      endDate:   a.end.toISOString(),
      type:      a.callType,
      limit:     String(PAGE_SIZE),
      offset:    String(off),
    });
    if (a.cli) params.set('cli', a.cli);
    if (a.cld) params.set('cld', a.cld);
    return `/api/sippy/cdr?${params.toString()}`;
  };

  const { data, isLoading, isFetching, refetch } = useQuery<{ cdrs: any[] }>({
    queryKey,
    queryFn: () => fetch(buildUrl(applied, offset)).then(r => r.json()),
    staleTime: 30_000,
  });

  const cdrs = data?.cdrs || [];
  const hasMore = cdrs.length === PAGE_SIZE;

  function applyFilters() {
    const s = new Date(startInput);
    const e = new Date(endInput);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return;
    setStart(s); setEnd(e);
    setApplied({ start: s, end: e, callType, cli, cld });
    setPage(0);
  }

  function applyPreset(fn: () => [Date, Date]) {
    const [s, e] = fn();
    setStart(s); setEnd(e);
    setStartInput(toInput(s)); setEndInput(toInput(e));
    setApplied({ start: s, end: e, callType, cli, cld });
    setPage(0);
  }

  function clearSearch() {
    setCli(''); setCld('');
    setApplied(prev => ({ ...prev, cli: '', cld: '' }));
    setPage(0);
  }

  // Summaries
  const totals = useMemo(() => {
    let totalCalls = 0, answered = 0, totalDur = 0, billedDur = 0, charged = 0;
    for (const c of cdrs) {
      totalCalls++;
      const dur = c.totalDuration || 0;
      const billed = c.duration || 0;
      if (billed > 0) answered++;
      totalDur  += dur;
      billedDur += billed;
      charged   += c.cost || 0;
    }
    return { totalCalls, answered, totalDur, billedDur, charged };
  }, [cdrs]);

  function downloadCSV() {
    const headers = ['Caller','CLI','CLD','Country','Description','Setup Time','Duration','Billed Duration','Charged (USD)','Result'];
    const rows = cdrs.map(c => [
      c.clientName || c.caller || '',
      c.caller || '',
      c.callee || '',
      c.country || '',
      c.areaName || c.description || '',
      fmtSetupTime(c.startTime),
      fmtDurSec(c.totalDuration || 0),
      fmtDurSec(c.duration || 0),
      fmtCurrency(c.cost || 0),
      c.result || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `cdrs_${formatUTC(applied.start, 'yyyyMMdd_HHmm')}_${formatUTC(applied.end, 'yyyyMMdd_HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CDR Viewer</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Customer Call Detail Records — charging &amp; billing history
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-cdrs"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={downloadCSV}
            disabled={cdrs.length === 0}
            data-testid="button-download-cdrs"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      {/* Filters card */}
      <div className="rounded-xl border border-border bg-card/60 p-4 space-y-4">
        {/* Date presets */}
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.fn as () => [Date, Date])}
              className="text-xs px-2.5 py-1 rounded-md border border-border/60 bg-muted/30 hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
              data-testid={`preset-${p.label.replace(/\s/g,'-').toLowerCase()}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Date + filters row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Start Date/Time</label>
            <Input
              type="datetime-local"
              value={startInput}
              onChange={e => setStartInput(e.target.value)}
              className="h-8 text-xs"
              data-testid="input-start-date"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">End Date/Time</label>
            <Input
              type="datetime-local"
              value={endInput}
              onChange={e => setEndInput(e.target.value)}
              className="h-8 text-xs"
              data-testid="input-end-date"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">CLI (Source)</label>
            <Input
              placeholder="e.g. +971..."
              value={cli}
              onChange={e => setCli(e.target.value)}
              className="h-8 text-xs"
              data-testid="input-filter-cli"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">CLD (Destination)</label>
            <Input
              placeholder="e.g. 9231..."
              value={cld}
              onChange={e => setCld(e.target.value)}
              className="h-8 text-xs"
              data-testid="input-filter-cld"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Show Calls</label>
            <Select value={callType} onValueChange={setCallType}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-call-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALL_TYPE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={applyFilters}
            data-testid="button-apply-filters"
          >
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            Update Report
          </Button>
          {(applied.cli || applied.cld) && (
            <Button
              variant="ghost" size="sm"
              onClick={clearSearch}
              data-testid="button-clear-search"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear Search
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {formatUTC(applied.start, 'dd MMM yyyy HH:mm')} → {formatUTC(applied.end, 'dd MMM yyyy HH:mm')} UTC
          </span>
        </div>
      </div>

      {/* Summary stats */}
      {!isLoading && cdrs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Calls (this page)', val: totals.totalCalls.toString(), icon: Activity, color: 'text-blue-400' },
            { label: 'Answered',          val: totals.answered.toString(),   icon: Phone,    color: 'text-emerald-400' },
            { label: 'Total Duration',    val: fmtDurSec(totals.totalDur),   icon: Clock,    color: 'text-amber-400' },
            { label: 'Charged (USD)',     val: `$${fmtCurrency(totals.charged)}`, icon: DollarSign, color: 'text-violet-400' },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
              <s.icon className={cn('h-4 w-4 flex-shrink-0', s.color)} />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-sm font-semibold font-mono" data-testid={`stat-${s.label.replace(/\s/g,'-').toLowerCase()}`}>{s.val}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CDR Table */}
      <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
        {/* Pagination header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/20">
          <span className="text-xs text-muted-foreground font-medium">
            {isLoading ? 'Loading…' : `Showing ${offset + 1}–${offset + cdrs.length} records${hasMore ? '+' : ''}`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7"
              disabled={page === 0 || isFetching}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-1">Page {page + 1}</span>
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7"
              disabled={!hasMore || isFetching}
              onClick={() => setPage(p => p + 1)}
              data-testid="button-next-page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                <th className="w-8 px-2 py-2.5 text-center text-muted-foreground font-medium">&nbsp;</th>
                <th className="px-3 py-2.5 text-left text-muted-foreground font-medium">Caller</th>
                <th className="px-3 py-2.5 text-left text-muted-foreground font-medium">CLI</th>
                <th className="px-3 py-2.5 text-left text-muted-foreground font-medium">CLD</th>
                <th className="px-3 py-2.5 text-center text-muted-foreground font-medium">Country</th>
                <th className="px-3 py-2.5 text-left text-muted-foreground font-medium">Description</th>
                <th className="px-3 py-2.5 text-right text-muted-foreground font-medium whitespace-nowrap">Setup Time</th>
                <th className="px-3 py-2.5 text-right text-muted-foreground font-medium whitespace-nowrap">Duration</th>
                <th className="px-3 py-2.5 text-right text-muted-foreground font-medium whitespace-nowrap">Billed</th>
                <th className="px-3 py-2.5 text-right text-muted-foreground font-medium whitespace-nowrap">Charged (USD)</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 12 }).map((_, i) => (
                <tr key={i} className={cn("border-b border-border/20", i % 2 === 0 ? "bg-card/20" : "bg-muted/10")}>
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="px-3 py-2">
                      <Skeleton className="h-3 w-full" />
                    </td>
                  ))}
                </tr>
              ))}

              {!isLoading && cdrs.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <PhoneOff className="h-8 w-8 opacity-30" />
                      <p className="text-sm font-medium">No CDR records found</p>
                      <p className="text-xs opacity-70 max-w-xs text-center">
                        CDR records appear here once calls have been made and completed through your accounts (PUSHTOTALK, aircel, asif). Try expanding the date range or changing the call type filter.
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {!isLoading && cdrs.map((cdr, i) => {
                const status = getCdrStatus(cdr);
                const isAnswered = status === 'answered';
                return (
                  <tr
                    key={`${cdr.callId}-${i}`}
                    className={cn(
                      "border-b border-border/20 transition-colors hover:bg-muted/20",
                      i % 2 === 0 ? "bg-card/20" : "bg-muted/10",
                    )}
                    data-testid={`row-cdr-${i}`}
                  >
                    <td className="px-2 py-2 text-center">
                      <StatusIcon cdr={cdr} />
                    </td>
                    <td className="px-3 py-2 max-w-[120px] truncate" title={cdr.clientName || cdr.caller || ''}>
                      <span className="text-foreground/80">{cdr.clientName || `Acct.${cdr.iAccount || '-'}`}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-foreground/70" data-testid={`text-cli-${i}`}>{cdr.caller || '-'}</td>
                    <td className="px-3 py-2 font-mono text-foreground/70" data-testid={`text-cld-${i}`}>{cdr.callee || '-'}</td>
                    <td className="px-3 py-2 text-center">
                      {cdr.country ? (
                        <span className="flex items-center justify-center gap-1 text-foreground/60">
                          <Globe className="h-3 w-3" />
                          {cdr.country}
                        </span>
                      ) : <span className="text-muted-foreground/40">-</span>}
                    </td>
                    <td className="px-3 py-2 text-foreground/60 max-w-[160px] truncate" title={cdr.areaName || cdr.description || ''}>
                      {cdr.areaName || cdr.description || '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-foreground/60 whitespace-nowrap">
                      {fmtSetupTime(cdr.startTime)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      <span className={isAnswered ? "text-emerald-400" : "text-muted-foreground/50"}>
                        {fmtDurSec(cdr.totalDuration || 0)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      <span className={isAnswered ? "text-blue-400" : "text-muted-foreground/50"}>
                        {fmtDurSec(cdr.duration || 0)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {(cdr.cost || 0) > 0 ? (
                        <span className="text-amber-400 font-semibold">{fmtCurrency(cdr.cost)}</span>
                      ) : (
                        <span className="text-muted-foreground/40">0.0000000</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Bottom pagination */}
        {!isLoading && cdrs.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 bg-muted/10">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" />
                <span>Answered ({totals.answered})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 inline-block" />
                <span>SIP Error</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/60 inline-block" />
                <span>Cancelled/Incomplete</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="sm"
                disabled={page === 0 || isFetching}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                data-testid="button-prev-page-bottom"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Prev
              </Button>
              <Button
                variant="ghost" size="sm"
                disabled={!hasMore || isFetching}
                onClick={() => setPage(p => p + 1)}
                data-testid="button-next-page-bottom"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
