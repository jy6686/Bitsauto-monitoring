/**
 * commercial-live-calls.tsx — Standalone Portfolio Live Calls Page
 *
 * Uses GET /api/commercial/live-calls which does server-side hierarchy filtering.
 * One endpoint, no client-side intersection required.
 *
 * This page is also embedded as the "Live Calls" section inside
 * the commercial workspace (/commercial). It exists as a standalone
 * route (/commercial-live-calls) for direct-link access.
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Phone, PhoneOff, Activity, Search, RefreshCw, Wifi, WifiOff,
  AlertTriangle, Info, Globe, Clock, Building2,
  TrendingUp, ChevronDown, ChevronUp,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LiveCall {
  accountId?:   string;
  clientName?:  string;
  callStatus:   string;
  cli?:         string;
  cld?:         string;
  duration?:    number;
  connection?:  string;
  vendor?:      string;
  destCountry?: string;
  destFull?:    string;
}

interface LiveCallsResponse {
  calls:         LiveCall[];
  total:         number;
  totalOnSwitch: number;
  scopeError:    'no_kam_link' | 'no_accounts' | null;
  orgRole:       string | null;
  lastUpdated:   number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs?: number): string {
  if (!secs || secs < 0) return '—';
  const m = Math.floor(secs / 60), s = secs % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function ScopeBar({
  data, isFetching,
}: {
  data:       LiveCallsResponse | undefined;
  isFetching: boolean;
}) {
  if (!data) return null;
  if (data.scopeError === 'no_kam_link') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Your account is not linked to a KAM profile. Contact your administrator.
      </div>
    );
  }
  if (data.scopeError === 'no_accounts') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        No clients are assigned to your portfolio yet.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/50 text-muted-foreground text-xs">
      <Info className="w-3.5 h-3.5 shrink-0" />
      <span>
        Showing <span className="font-semibold text-foreground">{data.total}</span> live call{data.total !== 1 ? 's' : ''} from your{' '}
        <span className="font-semibold text-foreground">{data.orgRole ?? 'KAM'}</span> portfolio
        {data.totalOnSwitch !== data.total && (
          <span className="text-muted-foreground/60"> ({data.totalOnSwitch} total on switch)</span>
        )}
      </span>
      {isFetching && <RefreshCw className="w-3 h-3 animate-spin text-emerald-400 ml-auto shrink-0" />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const AUTO_REFRESH_MS = 15_000;

export default function CommercialLiveCallsPage() {
  const [search,    setSearch   ] = useState('');
  const [sortField, setSortField] = useState<keyof LiveCall>('duration');
  const [sortAsc,   setSortAsc  ] = useState(false);
  const [tick,      setTick     ] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => setTick(t => t + 1), AUTO_REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  // Single endpoint — server does hierarchy filtering
  const q = useQuery<LiveCallsResponse>({
    queryKey: ['/api/commercial/live-calls', tick],
    queryFn: async () => {
      const r = await fetch('/api/commercial/live-calls');
      if (!r.ok) throw new Error('Failed to load live calls');
      return r.json();
    },
    staleTime: 10_000,
  });

  const data     = q.data;
  const allCalls = data?.calls ?? [];

  // Local search filter
  const searched = useMemo(() => {
    if (!search.trim()) return allCalls;
    const lq = search.toLowerCase();
    return allCalls.filter(c =>
      (c.clientName ?? '').toLowerCase().includes(lq) ||
      (c.cli ?? '').includes(lq) ||
      (c.cld ?? '').includes(lq) ||
      (c.destCountry ?? '').toLowerCase().includes(lq) ||
      (c.accountId ?? '').includes(lq)
    );
  }, [allCalls, search]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...searched];
    arr.sort((a, b) => {
      const av = a[sortField] ?? '', bv = b[sortField] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [searched, sortField, sortAsc]);

  function toggleSort(field: keyof LiveCall) {
    if (sortField === field) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(false); }
  }

  function SortIcon({ field }: { field: keyof LiveCall }) {
    if (sortField !== field) return null;
    return sortAsc ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
  }

  const connected  = allCalls.filter(c => c.callStatus === 'connected').length;
  const routing    = allCalls.filter(c => c.callStatus !== 'connected').length;
  const countries  = new Set(allCalls.map(c => c.destCountry).filter(Boolean)).size;
  const avgDur     = allCalls.length > 0
    ? Math.round(allCalls.reduce((s, c) => s + (c.duration ?? 0), 0) / allCalls.length)
    : 0;
  const lastUpdated = data?.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : '—';
  const hasScopeError = !!data?.scopeError;

  return (
    <div className="space-y-6 p-1">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Phone className="w-6 h-6 text-emerald-400" />
            Live Calls
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Portfolio-scoped · server-filtered · auto-refresh 15 s
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {q.isFetching
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            : <RefreshCw className="w-3.5 h-3.5" />
          }
          Updated {lastUpdated}
        </div>
      </div>

      <ScopeBar data={data} isFetching={q.isFetching} />

      {/* KPI strip */}
      {!hasScopeError && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Portfolio Calls', value: data?.total ?? 0,        icon: Phone,       color: 'text-sky-400'     },
            { label: 'Connected',       value: connected,                icon: Wifi,        color: 'text-emerald-400' },
            { label: 'Routing',         value: routing,                  icon: Activity,    color: 'text-amber-400'   },
            { label: 'Destinations',    value: countries,                icon: Globe,       color: 'text-violet-400'  },
          ].map(k => (
            <div key={k.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center gap-3">
              <k.icon className={`w-4 h-4 shrink-0 ${k.color}`} />
              <div>
                <div className="text-lg font-bold tabular-nums">{k.value}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {!hasScopeError && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            data-testid="input-live-call-search"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client, CLI, CLD, country…"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border/60 bg-muted/30 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      )}

      {/* Table */}
      {!hasScopeError && (
        <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {([
                    ['Client',      'clientName' as keyof LiveCall],
                    ['CLI',         'cli'        as keyof LiveCall],
                    ['CLD',         'cld'        as keyof LiveCall],
                    ['Destination', 'destFull'   as keyof LiveCall],
                    ['Duration',    'duration'   as keyof LiveCall],
                    ['Status',      'callStatus' as keyof LiveCall],
                    ['Vendor',      'vendor'     as keyof LiveCall],
                  ] as [string, keyof LiveCall][]).map(([label, field]) => (
                    <th
                      key={label}
                      onClick={() => toggleSort(field)}
                      className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                    >
                      {label}<SortIcon field={field} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.isLoading && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-muted-foreground">
                      <Activity className="w-5 h-5 animate-pulse mx-auto mb-2" />
                      Fetching portfolio calls…
                    </td>
                  </tr>
                )}
                {!q.isLoading && sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-muted-foreground text-sm">
                      {search
                        ? `No calls match "${search}"`
                        : <span className="flex flex-col items-center gap-2">
                            <PhoneOff className="w-8 h-8 text-muted-foreground/30" />
                            No active calls in your portfolio.
                          </span>
                      }
                    </td>
                  </tr>
                )}
                {!q.isLoading && sorted.map((c, i) => (
                  <tr
                    key={`${c.cli}-${c.cld}-${i}`}
                    data-testid={`row-live-call-${i}`}
                    className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/5'}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                        <span className="text-xs font-medium truncate max-w-[120px]">
                          {c.clientName ?? `Acct.${c.accountId ?? '—'}`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.cli ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.cld ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {c.destFull || c.destCountry
                        ? <div className="flex items-center gap-1">
                            <Globe className="w-3 h-3 text-violet-400/60 shrink-0" />
                            <span className="text-xs text-muted-foreground truncate max-w-[140px]">{c.destFull ?? c.destCountry}</span>
                          </div>
                        : <span className="text-muted-foreground/40 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 text-xs tabular-nums">
                        <Clock className="w-3 h-3 text-muted-foreground/40" />
                        <span className={c.callStatus === 'connected' ? 'text-emerald-400' : 'text-muted-foreground'}>
                          {fmtDuration(c.duration)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${
                        c.callStatus === 'connected'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }`}>
                        {c.callStatus === 'connected'
                          ? <Wifi className="w-2.5 h-2.5" />
                          : <Activity className="w-2.5 h-2.5 animate-pulse" />
                        }
                        {c.callStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[100px]">
                      {c.vendor ?? c.connection ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!q.isLoading && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/40 bg-muted/10 text-xs text-muted-foreground">
              <span>{sorted.length} call{sorted.length !== 1 ? 's' : ''}{search && ` matching "${search}"`}</span>
              {avgDur > 0 && (
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Avg {fmtDuration(avgDur)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
