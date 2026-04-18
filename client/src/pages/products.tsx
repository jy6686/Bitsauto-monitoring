import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { lookupCLD } from "@/lib/country-lookup";
import {
  subHoursUTC, subDaysUTC, startOfDayUTC, endOfDayUTC,
  startOfWeekUTC, subWeeksUTC, endOfWeekUTC,
  startOfMonthUTC, subMonthsUTC, endOfMonthUTC,
  formatUTC,
} from "@/lib/date-utils";
import { useTimezone } from "@/context/timezone-context";
import {
  Package, Phone, Clock, DollarSign, Activity, BarChart3,
  TrendingUp, Filter, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PRODUCT_CLASSES = [
  { prefix: '1', label: 'First Class Wholesale',   short: 'First',    color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20',      dot: 'bg-blue-400'    },
  { prefix: '2', label: 'Business Class Wholesale', short: 'Business', color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20',  dot: 'bg-violet-400'  },
  { prefix: '6', label: 'Special Bravo',            short: 'Bravo',    color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20',    dot: 'bg-amber-400'   },
  { prefix: '7', label: 'Special Charlie',          short: 'Charlie',  color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20',  dot: 'bg-orange-400'  },
  { prefix: 'other', label: 'Unclassified',         short: 'Other',    color: 'text-muted-foreground', bg: 'bg-muted/30 border-border',        dot: 'bg-muted-foreground' },
] as const;

type ProductPrefix = '1' | '2' | '6' | '7' | 'other';

interface ProductStats {
  calls: number;
  answered: number;
  totalDuration: number;
  billedDuration: number;
  cost: number;
  topCountries: Record<string, number>;
}

function emptyStats(): ProductStats {
  return { calls: 0, answered: 0, totalDuration: 0, billedDuration: 0, cost: 0, topCountries: {} };
}

function fmtDurSec(seconds: number): string {
  const s = Math.round(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

const RANGE_OPTIONS = [
  { label: 'Last 1 hour',  key: '1h',   fn: () => [subHoursUTC(new Date(), 1),   new Date()] },
  { label: 'Last 6 hours', key: '6h',   fn: () => [subHoursUTC(new Date(), 6),   new Date()] },
  { label: 'Last 24 hours',key: '24h',  fn: () => [subHoursUTC(new Date(), 24),  new Date()] },
  { label: 'Today',        key: 'today',fn: () => [startOfDayUTC(new Date()),     new Date()] },
  { label: 'Yesterday',    key: 'yesterday', fn: () => [startOfDayUTC(subDaysUTC(new Date(), 1)), endOfDayUTC(subDaysUTC(new Date(), 1))] },
  { label: 'This week',    key: 'week', fn: () => [startOfWeekUTC(new Date()),    new Date()] },
  { label: 'Last week',    key: 'lweek',fn: () => [startOfWeekUTC(subWeeksUTC(new Date(), 1)), endOfWeekUTC(subWeeksUTC(new Date(), 1))] },
  { label: 'This month',   key: 'month',fn: () => [startOfMonthUTC(new Date()),   new Date()] },
  { label: 'Last month',   key: 'lmonth',fn:() => [startOfMonthUTC(subMonthsUTC(new Date(), 1)), endOfMonthUTC(subMonthsUTC(new Date(), 1))] },
];

export default function ProductsPage() {
  const { tz } = useTimezone();
  const [rangeKey, setRangeKey] = useState('24h');

  const [start, end] = useMemo(() => {
    const opt = RANGE_OPTIONS.find(o => o.key === rangeKey) ?? RANGE_OPTIONS[2];
    return opt.fn() as [Date, Date];
  }, [rangeKey]);

  const params = new URLSearchParams({
    startDate: start.toISOString(),
    endDate:   end.toISOString(),
    type:      'all',
    limit:     '2000',
    offset:    '0',
  });
  const queryKey = ['/api/sippy/cdr', 'products', start.toISOString(), end.toISOString()];

  const { data, isLoading, isFetching, refetch } = useQuery<{ cdrs: any[] }>({
    queryKey,
    queryFn: () => fetch(`/api/sippy/cdr?${params.toString()}`).then(r => r.json()),
    staleTime: 60_000,
  });

  const cdrs = data?.cdrs || [];

  const stats = useMemo(() => {
    const buckets: Record<string, ProductStats> = {
      '1': emptyStats(), '2': emptyStats(), '6': emptyStats(),
      '7': emptyStats(), 'other': emptyStats(),
    };

    for (const c of cdrs) {
      const cldInfo = c.callee ? lookupCLD(c.callee) : null;
      const prefix: string = cldInfo?.trunkPrefix ?? 'other';
      const bucket = buckets[prefix] ?? buckets['other'];
      const countryName = cldInfo?.country ? `${cldInfo.country.flag} ${cldInfo.country.name}` : (c.country || 'Unknown');

      bucket.calls++;
      if ((c.duration || 0) > 0) bucket.answered++;
      bucket.totalDuration += c.totalDuration || 0;
      bucket.billedDuration += c.duration || 0;
      bucket.cost += c.cost || 0;
      bucket.topCountries[countryName] = (bucket.topCountries[countryName] || 0) + 1;
    }

    return buckets as Record<ProductPrefix, ProductStats>;
  }, [cdrs]);

  const totalCalls = cdrs.length;
  const classifiedCalls = Object.entries(stats)
    .filter(([k]) => k !== 'other')
    .reduce((acc, [, v]) => acc + v.calls, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">Product Classification</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-primary/10 border-primary/30 text-primary">
              <Package className="h-3 w-3" />
              Sippy Trunk Classes
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            CDR breakdown by product / trunk class — first digit of CLD encodes the service tier.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={rangeKey} onValueChange={setRangeKey}>
            <SelectTrigger className="h-8 text-xs w-36" data-testid="select-product-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map(o => (
                <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline" size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-products-refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Legend row */}
      <div className="flex flex-wrap gap-3">
        {PRODUCT_CLASSES.map(cls => (
          <div
            key={cls.prefix}
            className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium", cls.bg, cls.color)}
          >
            <span className={cn("h-2 w-2 rounded-full", cls.dot)} />
            <span className="font-mono text-[11px] opacity-70">
              {cls.prefix === 'other' ? '?' : cls.prefix}
            </span>
            {cls.label}
          </div>
        ))}
      </div>

      {/* KPI Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
        {PRODUCT_CLASSES.map(cls => {
          const s = stats[cls.prefix as ProductPrefix] ?? emptyStats();
          const asr = s.calls > 0 ? Math.round((s.answered / s.calls) * 100) : 0;
          const pct = totalCalls > 0 ? Math.round((s.calls / totalCalls) * 100) : 0;

          return (
            <div
              key={cls.prefix}
              className={cn(
                "rounded-xl border p-4 space-y-3",
                cls.bg,
              )}
              data-testid={`card-product-${cls.prefix}`}
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-xs font-semibold uppercase tracking-wide", cls.color)}>
                  {cls.short}
                </span>
                {cls.prefix !== 'other' && (
                  <span className={cn(
                    "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border",
                    cls.bg, cls.color
                  )}>
                    PREFIX: {cls.prefix}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-medium leading-tight">{cls.label}</p>

              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-7 w-24" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-2xl font-bold tabular-nums" data-testid={`stat-calls-${cls.prefix}`}>
                      {s.calls.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">calls ({pct}% of total)</p>
                  </div>

                  {/* ASR bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">ASR</span>
                      <span className={cn("font-semibold", asr >= 60 ? "text-emerald-400" : asr >= 30 ? "text-amber-400" : "text-red-400")}>
                        {asr}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-background/40 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", asr >= 60 ? "bg-emerald-500" : asr >= 30 ? "bg-amber-500" : "bg-red-500")}
                        style={{ width: `${asr}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Duration</p>
                      <p className="font-mono font-semibold">{fmtDurSec(s.totalDuration)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Charged</p>
                      <p className="font-mono font-semibold text-amber-400">${s.cost.toFixed(4)}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Detailed comparison table */}
      <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/50 bg-muted/20 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Product Class Comparison</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatUTC(start, 'dd MMM yyyy')} → {formatUTC(end, 'dd MMM yyyy')}
            {' '}· {totalCalls.toLocaleString()} total calls
            {totalCalls > 0 && ` (${classifiedCalls.toLocaleString()} classified)`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Product Class</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Calls</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Answered</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">ASR</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Duration</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Billed</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Charged (USD)</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/20">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-2.5">
                          <Skeleton className="h-3 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                : PRODUCT_CLASSES.map(cls => {
                    const s = stats[cls.prefix as ProductPrefix] ?? emptyStats();
                    const asr = s.calls > 0 ? Math.round((s.answered / s.calls) * 100) : 0;
                    const pct = totalCalls > 0 ? ((s.calls / totalCalls) * 100).toFixed(1) : '0.0';

                    return (
                      <tr key={cls.prefix} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className={cn("h-2 w-2 rounded-full flex-shrink-0", cls.dot)} />
                            <span className={cn("font-semibold", cls.color)}>{cls.label}</span>
                            {cls.prefix !== 'other' && (
                              <span className="text-[10px] font-mono text-muted-foreground/50 ml-1">
                                (digit: {cls.prefix})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">
                          {s.calls.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-400">
                          {s.answered.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={cn(
                            "font-semibold tabular-nums",
                            asr >= 60 ? "text-emerald-400" : asr >= 30 ? "text-amber-400" : "text-red-400"
                          )}>
                            {asr}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-foreground/70">
                          {fmtDurSec(s.totalDuration)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-blue-400">
                          {fmtDurSec(s.billedDuration)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-amber-400 font-semibold">
                          ${s.cost.toFixed(4)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-background/40 overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", cls.dot)}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-muted-foreground w-9 text-right tabular-nums">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
            {!isLoading && totalCalls > 0 && (
              <tfoot>
                <tr className="border-t border-border/50 bg-muted/20">
                  <td className="px-4 py-2.5 font-semibold">Total</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold">{totalCalls.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-400 font-bold">
                    {Object.values(stats).reduce((a, s) => a + s.answered, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold">
                    {(() => {
                      const totalAnswered = Object.values(stats).reduce((a, s) => a + s.answered, 0);
                      return totalCalls > 0 ? `${Math.round((totalAnswered / totalCalls) * 100)}%` : '0%';
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold">
                    {fmtDurSec(Object.values(stats).reduce((a, s) => a + s.totalDuration, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-blue-400">
                    {fmtDurSec(Object.values(stats).reduce((a, s) => a + s.billedDuration, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-amber-400">
                    ${Object.values(stats).reduce((a, s) => a + s.cost, 0).toFixed(4)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground text-[11px]">100%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Top countries per class */}
        {!isLoading && totalCalls > 0 && (
          <div className="border-t border-border/50 p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Top Destinations per Product Class
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {PRODUCT_CLASSES.filter(cls => cls.prefix !== 'other').map(cls => {
                const s = stats[cls.prefix as ProductPrefix];
                const topEntries = Object.entries(s.topCountries)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5);

                return (
                  <div key={cls.prefix} className="space-y-1.5">
                    <p className={cn("text-xs font-semibold", cls.color)}>{cls.short}</p>
                    {topEntries.length === 0 ? (
                      <p className="text-xs text-muted-foreground/50 italic">No traffic</p>
                    ) : (
                      topEntries.map(([country, count]) => (
                        <div key={country} className="flex items-center justify-between text-xs gap-2">
                          <span className="text-foreground/70 truncate">{country}</span>
                          <span className="font-mono text-muted-foreground flex-shrink-0">{count.toLocaleString()}</span>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
