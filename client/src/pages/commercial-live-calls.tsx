import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Phone, PhoneOff, Activity, Search, RefreshCw, Wifi, WifiOff,
  AlertTriangle, Info, Globe, Zap, Clock, Building2,
  TrendingUp, ChevronDown, ChevronUp,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommercialScope {
  accountIds: string[];
  kamIds:     number[];
  orgRole:    string | null;
  isAdmin:    boolean;
  scopeError: 'no_kam_link' | 'no_accounts' | null;
}

interface LiveCall {
  accountId?:   string;
  clientName?:  string;
  callStatus:   'connected' | 'routing' | string;
  ccState?:     string;
  cli?:         string;
  cld?:         string;
  duration?:    number;
  connection?:  string;
  vendor?:      string;
  destCountry?: string;
  destFull?:    string;
  trunkClass?:  string;
  startTime?:   string;
}

interface LiveCallsResponse {
  calls:            LiveCall[];
  totalActiveCalls: number;
  connected:        boolean;
  stale?:           boolean;
  lastUpdated?:     number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs?: number): string {
  if (!secs || secs < 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function CallStatusBadge({ status }: { status: string }) {
  const isConnected = status === 'connected';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${
      isConnected
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
        : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    }`}>
      {isConnected
        ? <Wifi className="w-2.5 h-2.5" />
        : <Activity className="w-2.5 h-2.5 animate-pulse" />
      }
      {isConnected ? 'Connected' : 'Routing'}
    </span>
  );
}

// ── Scope indicator ───────────────────────────────────────────────────────────

function ScopeBar({
  scopeError, isAdmin, orgRole, scopedCount, totalCount,
}: {
  scopeError:  string | null;
  isAdmin:     boolean;
  orgRole:     string | null;
  scopedCount: number;
  totalCount:  number;
}) {
  if (scopeError === 'no_kam_link') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Your account is not linked to a KAM profile. Contact your administrator.
      </div>
    );
  }
  if (scopeError === 'no_accounts') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        No clients are assigned to your portfolio yet.
      </div>
    );
  }
  const roleLabel = isAdmin ? 'Platform Admin' : (orgRole ?? 'KAM');
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/50 text-muted-foreground text-xs">
      <Info className="w-3.5 h-3.5 shrink-0" />
      <span>
        Showing <span className="font-semibold text-foreground">{scopedCount}</span>{' '}
        live call{scopedCount !== 1 ? 's' : ''} across your{' '}
        <span className="font-semibold text-foreground">{roleLabel}</span> portfolio
        {totalCount !== scopedCount && (
          <span className="text-muted-foreground/60"> ({totalCount} total on switch)</span>
        )}
        {isAdmin && ' (all accounts)'}
      </span>
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh ticker
  useEffect(() => {
    timerRef.current = setInterval(() => setTick(t => t + 1), AUTO_REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Scope query (hierarchy-resolved, server-side) ───────────────────────────
  const scopeQ = useQuery<CommercialScope>({
    queryKey: ['/api/commercial/scope'],
    staleTime: 5 * 60_000, // 5 min — matches server cache TTL
  });

  // ── Live calls query (all calls from Sippy cache) ──────────────────────────
  const liveQ = useQuery<LiveCallsResponse>({
    queryKey: ['/api/sippy/live-calls', tick],
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const scope     = scopeQ.data;
  const liveData  = liveQ.data;
  const isLoading = scopeQ.isLoading || liveQ.isLoading;

  // Build accountId Set for O(1) lookups
  const scopeSet = useMemo(() => {
    if (!scope?.accountIds) return null;
    return new Set(scope.accountIds.map(String));
  }, [scope?.accountIds]);

  // Filter live calls to scoped accounts
  const allCalls    = liveData?.calls ?? [];
  const scopedCalls = useMemo(() => {
    if (!scopeSet) return [];
    // Admin sees everything
    if (scope?.isAdmin) return allCalls;
    return allCalls.filter(c => c.accountId && scopeSet.has(String(c.accountId)));
  }, [allCalls, scopeSet, scope?.isAdmin]);

  // Apply search
  const searched = useMemo(() => {
    if (!search.trim()) return scopedCalls;
    const q = search.trim().toLowerCase();
    return scopedCalls.filter(c =>
      (c.clientName ?? '').toLowerCase().includes(q) ||
      (c.cli ?? '').includes(q) ||
      (c.cld ?? '').includes(q) ||
      (c.destCountry ?? '').toLowerCase().includes(q) ||
      (c.accountId ?? '').includes(q)
    );
  }, [scopedCalls, search]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...searched];
    arr.sort((a, b) => {
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortAsc ? av - bv : bv - av;
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [searched, sortField, sortAsc]);

  // Summary KPIs
  const connected = scopedCalls.filter(c => c.callStatus === 'connected').length;
  const routing   = scopedCalls.filter(c => c.callStatus !== 'connected').length;
  const countries = new Set(scopedCalls.map(c => c.destCountry).filter(Boolean)).size;
  const avgDur    = scopedCalls.length > 0
    ? Math.round(scopedCalls.reduce((s, c) => s + (c.duration ?? 0), 0) / scopedCalls.length)
    : 0;

  function toggleSort(field: keyof LiveCall) {
    if (sortField === field) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(false); }
  }

  function SortIcon({ field }: { field: keyof LiveCall }) {
    if (sortField !== field) return null;
    return sortAsc
      ? <ChevronUp   className="w-3 h-3 inline ml-0.5" />
      : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
  }

  const lastUpdated = liveData?.lastUpdated
    ? new Date(liveData.lastUpdated).toLocaleTimeString()
    : '—';

  return (
    <div className="space-y-6 p-1">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Phone className="w-6 h-6 text-emerald-400" />
            Live Calls
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time active calls for your portfolio — hierarchy-filtered, auto-refreshes every 15 s.
          </p>
        </div>

        {/* Refresh status */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {liveQ.isFetching
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            : <RefreshCw className="w-3.5 h-3.5" />
          }
          <span>Updated {lastUpdated}</span>
          {liveData?.stale && (
            <span className="text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Stale
            </span>
          )}
          {liveData?.connected === false && (
            <span className="text-red-400 flex items-center gap-1">
              <WifiOff className="w-3 h-3" /> Disconnected
            </span>
          )}
        </div>
      </div>

      {/* ── Scope bar ────────────────────────────────────────────────────── */}
      {!scopeQ.isLoading && (
        <ScopeBar
          scopeError={scope?.scopeError ?? null}
          isAdmin={scope?.isAdmin ?? false}
          orgRole={scope?.orgRole ?? null}
          scopedCount={scopedCalls.length}
          totalCount={allCalls.length}
        />
      )}

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      {!(scope?.scopeError) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total',      value: scopedCalls.length, icon: Phone,      color: 'text-sky-400'     },
            { label: 'Connected',  value: connected,          icon: Wifi,       color: 'text-emerald-400' },
            { label: 'Routing',    value: routing,            icon: Zap,        color: 'text-amber-400'   },
            { label: 'Countries',  value: countries,          icon: Globe,      color: 'text-violet-400'  },
          ].map(kpi => (
            <div key={kpi.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center gap-3">
              <kpi.icon className={`w-4 h-4 shrink-0 ${kpi.color}`} />
              <div>
                <div className="text-lg font-bold tabular-nums">{kpi.value}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Search ───────────────────────────────────────────────────────── */}
      {!(scope?.scopeError) && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            data-testid="input-live-call-search"
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); }}
            placeholder="Search by client, CLI, CLD, country…"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border/60 bg-muted/30 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      )}

      {/* ── Calls table ──────────────────────────────────────────────────── */}
      {!(scope?.scopeError) && (
        <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {[
                    { label: 'Client',      field: 'clientName' as keyof LiveCall  },
                    { label: 'CLI',         field: 'cli'        as keyof LiveCall  },
                    { label: 'CLD',         field: 'cld'        as keyof LiveCall  },
                    { label: 'Destination', field: 'destFull'   as keyof LiveCall  },
                    { label: 'Duration',    field: 'duration'   as keyof LiveCall  },
                    { label: 'Status',      field: 'callStatus' as keyof LiveCall  },
                    { label: 'Vendor',      field: 'vendor'     as keyof LiveCall  },
                  ].map(col => (
                    <th
                      key={col.label}
                      onClick={() => toggleSort(col.field)}
                      className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                    >
                      {col.label}<SortIcon field={col.field} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-muted-foreground">
                      <Activity className="w-5 h-5 animate-pulse mx-auto mb-2" />
                      Fetching live calls…
                    </td>
                  </tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-muted-foreground text-sm">
                      {search
                        ? `No calls match "${search}"`
                        : scopedCalls.length === 0
                          ? <span className="flex flex-col items-center gap-2">
                              <PhoneOff className="w-8 h-8 text-muted-foreground/30" />
                              No active calls in your portfolio right now.
                            </span>
                          : 'No calls match your filter.'
                      }
                    </td>
                  </tr>
                )}
                {!isLoading && sorted.map((call, i) => (
                  <tr
                    key={`${call.cli}-${call.cld}-${i}`}
                    data-testid={`row-live-call-${i}`}
                    className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/5'}`}
                  >
                    {/* Client */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                        <span className="font-medium text-xs text-foreground truncate max-w-[120px]">
                          {call.clientName ?? `Acct. ${call.accountId ?? '—'}`}
                        </span>
                      </div>
                    </td>

                    {/* CLI */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-muted-foreground">{call.cli ?? '—'}</span>
                    </td>

                    {/* CLD */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-muted-foreground">{call.cld ?? '—'}</span>
                    </td>

                    {/* Destination */}
                    <td className="px-4 py-2.5">
                      {call.destFull || call.destCountry
                        ? (
                          <div className="flex items-center gap-1">
                            <Globe className="w-3 h-3 text-violet-400/60 shrink-0" />
                            <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                              {call.destFull ?? call.destCountry}
                            </span>
                          </div>
                        )
                        : <span className="text-muted-foreground/40 text-xs">—</span>
                      }
                    </td>

                    {/* Duration */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 text-xs tabular-nums">
                        <Clock className="w-3 h-3 text-muted-foreground/40" />
                        <span className={call.callStatus === 'connected' ? 'text-emerald-400' : 'text-muted-foreground'}>
                          {fmtDuration(call.duration)}
                        </span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2.5">
                      <CallStatusBadge status={call.callStatus} />
                    </td>

                    {/* Vendor */}
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-muted-foreground truncate max-w-[100px] block">
                        {call.vendor ?? call.connection ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          {!isLoading && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/40 bg-muted/10 text-xs text-muted-foreground">
              <span>
                {sorted.length} call{sorted.length !== 1 ? 's' : ''}
                {search && ` matching "${search}"`}
              </span>
              {avgDur > 0 && (
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Avg. duration: {fmtDuration(avgDur)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
