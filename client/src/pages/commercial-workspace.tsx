/**
 * commercial-workspace.tsx — Commercial Portal Single-Page Workspace
 *
 * Scope is resolved ONCE inside CommercialWorkspaceProvider (context).
 * Every section consumes shared context via useCommercialWorkspace() —
 * no prop-drilling, no duplicate scope resolution.
 *
 * Section inventory:
 *   Dashboard     · portfolio KPIs + at-risk alert strip
 *   Clients       · paginated/searchable hierarchy-scoped account table
 *   Live Calls    · server-filtered live calls (15 s auto-refresh)
 *   Live Traffic  · BitsEye2-style per-account traffic cards (CH-3)
 *   Balance       · read-only account balance table
 *   Products      · rate push job history + links to Rate Manager
 *   Reports       · read-only links to Revenue / Forecast / P&L
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery }                              from "@tanstack/react-query";
import { Link }                                  from "wouter";
import {
  LayoutDashboard, Users, Phone, Activity, Wallet, Layers,
  BarChart2, Search, AlertTriangle, Info,
  Wifi, WifiOff, Clock, Building2,
  TrendingUp, TrendingDown, Minus,
  RefreshCw, ShieldAlert, DollarSign,
  ExternalLink, FileText, ArrowRight, Lock, Globe,
  Gauge, Zap, CheckCircle2, XCircle, AlertCircle, Signal,
  type LucideProps,
} from "lucide-react";
import {
  CommercialWorkspaceProvider,
  useCommercialWorkspace,
} from "@/contexts/commercial-workspace-context";

// ── Section ID ────────────────────────────────────────────────────────────────

type SectionId =
  | 'dashboard' | 'intelligence' | 'clients' | 'live-calls'
  | 'live-traffic' | 'balance' | 'products' | 'reports';

// ── Shared micro-components ───────────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  const cfg: Record<string, string> = {
    healthy:    'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    at_risk:    'bg-red-500/15 text-red-400 border-red-500/30',
    degraded:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
    no_traffic: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    unknown:    'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  };
  const label = state.replace('_', ' ').replace(/^\w/, c => c.toUpperCase());
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${cfg[state] ?? cfg.unknown}`}>
      {label}
    </span>
  );
}

function TrendIcon({ dir }: { dir: string }) {
  if (dir === 'up')   return <TrendingUp   className="w-3 h-3 text-emerald-400" />;
  if (dir === 'down') return <TrendingDown className="w-3 h-3 text-red-400"    />;
  return <Minus className="w-3 h-3 text-muted-foreground/30" />;
}

function HealthBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground/40">—</span>;
  const pct   = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 rounded-full bg-muted/40">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums">{pct}</span>
    </div>
  );
}

function ScopeAlert({ error }: { error: string }) {
  const msg = error === 'no_kam_link'
    ? 'Your account is not linked to a KAM profile. Contact your administrator.'
    : 'No clients are assigned to your portfolio yet.';
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      {msg}
    </div>
  );
}

function fmtDuration(secs?: number): string {
  if (!secs || secs < 0) return '—';
  const m = Math.floor(secs / 60), s = secs % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

// ── Section: Dashboard ────────────────────────────────────────────────────────

function DashboardSection() {
  const { portfolio, kpis, liveData, liveCallCount } = useCommercialWorkspace();
  const atRisk  = portfolio.filter(a => ['at_risk', 'degraded'].includes(a.state));
  const rev24h  = portfolio.reduce((s, a) => s + (a.revenue24h ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-4">Portfolio Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Total Clients',    value: kpis?.accountCount    ?? 0,               icon: Users,       color: 'text-sky-400'     },
            { label: 'Live Calls',       value: liveCallCount,                             icon: Phone,       color: 'text-emerald-400' },
            { label: 'Revenue 24h',      value: `$${rev24h.toFixed(2)}`,                  icon: DollarSign,  color: 'text-violet-400'  },
            { label: 'At Risk',          value: atRisk.length,                            icon: ShieldAlert, color: 'text-red-400'     },
            { label: 'Pending Rates',    value: kpis?.pendingFirstRate ?? 0,               icon: FileText,    color: 'text-amber-400'   },
            { label: 'Pending Approval', value: kpis?.pendingApproval  ?? 0,              icon: Clock,       color: 'text-orange-400'  },
          ].map(k => (
            <div key={k.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center gap-3">
              <k.icon className={`w-4 h-4 shrink-0 ${k.color}`} />
              <div>
                <div className="text-xl font-bold tabular-nums">{k.value}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {atRisk.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5" /> Accounts Requiring Attention
          </h4>
          <div className="space-y-2">
            {atRisk.slice(0, 6).map(a => (
              <div key={a.accountId} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-red-500/20 bg-red-500/5">
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-red-400/60 shrink-0" />
                  <span className="text-sm font-medium">{a.clientName}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/50">#{a.accountId}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StateBadge state={a.state} />
                  {a.reasons[0] && (
                    <span className="text-xs text-muted-foreground/60 max-w-[200px] truncate hidden sm:block">
                      {a.reasons[0]}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section: Clients ──────────────────────────────────────────────────────────

const PAGE_SIZE = 30;

function ClientsSection() {
  const { portfolioMap, kpis } = useCommercialWorkspace();
  const [search,    setSearch   ] = useState('');
  const [apiSearch, setApiSearch] = useState('');
  const [page,      setPage     ] = useState(1);

  const clientsQ = useQuery<{ clients: any[]; total: number; scopeError: string | null }>({
    queryKey: ['/api/commercial/clients', apiSearch, page],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (apiSearch) p.set('search', apiSearch);
      p.set('page',  String(page));
      p.set('limit', String(PAGE_SIZE));
      const r = await fetch(`/api/commercial/clients?${p}`);
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    staleTime: 30_000,
  });

  const clients    = clientsQ.data?.clients ?? [];
  const total      = clientsQ.data?.total   ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Portfolio Clients</h3>
        <span className="text-xs text-muted-foreground">{total} accounts in scope</span>
      </div>
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          data-testid="input-ws-client-search"
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); setApiSearch(e.target.value); }}
          placeholder="Search clients…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border/60 bg-muted/30 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/20">
              {['Client', 'Acct ID', 'KAM', 'Health', 'Live', 'Rev 24h', 'Status', 'Trend'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clientsQ.isLoading && (
              <tr><td colSpan={8} className="text-center py-12 text-muted-foreground text-xs">
                <Activity className="w-4 h-4 animate-pulse mx-auto mb-1" />Loading…
              </td></tr>
            )}
            {!clientsQ.isLoading && clients.map((c, i) => {
              const stats = portfolioMap.get(c.accountId);
              return (
                <tr key={c.accountId} data-testid={`row-ws-client-${c.accountId}`}
                  className={`border-b border-border/25 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/5'}`}
                >
                  <td className="px-3 py-2"><span className="font-medium text-xs">{c.clientName}</span></td>
                  <td className="px-3 py-2"><span className="font-mono text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">{c.accountId}</span></td>
                  <td className="px-3 py-2"><span className="text-xs text-muted-foreground">{c.kamName}</span></td>
                  <td className="px-3 py-2"><HealthBar score={stats?.healthScore ?? null} /></td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold tabular-nums ${(stats?.liveCallCount ?? 0) > 0 ? 'text-emerald-400' : 'text-muted-foreground/40'}`}>
                      {stats?.liveCallCount ?? 0}
                    </span>
                  </td>
                  <td className="px-3 py-2"><span className="text-xs text-violet-400 tabular-nums">${(stats?.revenue24h ?? 0).toFixed(2)}</span></td>
                  <td className="px-3 py-2"><StateBadge state={stats?.state ?? 'unknown'} /></td>
                  <td className="px-3 py-2"><TrendIcon dir={stats?.trendDirection ?? 'stable'} /></td>
                </tr>
              );
            })}
            {!clientsQ.isLoading && clients.length === 0 && (
              <tr><td colSpan={8} className="text-center py-10 text-muted-foreground text-xs">
                {search ? `No clients match "${search}"` : 'No clients in scope.'}
              </td></tr>
            )}
          </tbody>
        </table>
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border/30 text-xs text-muted-foreground">
            <span>Page {page} of {totalPages} · {total} total</span>
            <div className="flex gap-1">
              <button disabled={page <= 1}          onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded hover:bg-muted/40 disabled:opacity-40">←</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded hover:bg-muted/40 disabled:opacity-40">→</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section: Live Calls ───────────────────────────────────────────────────────

function LiveCallsSection() {
  const { liveData } = useCommercialWorkspace();
  const [search, setSearch] = useState('');

  const allCalls = liveData?.calls ?? [];
  const searched = useMemo(() => {
    if (!search.trim()) return allCalls;
    const lq = search.toLowerCase();
    return allCalls.filter(c =>
      (c.clientName ?? '').toLowerCase().includes(lq) ||
      (c.cli  ?? '').includes(lq)                     ||
      (c.cld  ?? '').includes(lq)                     ||
      (c.destCountry ?? '').toLowerCase().includes(lq)
    );
  }, [allCalls, search]);

  const connected = allCalls.filter(c => c.callStatus === 'connected').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold">Live Calls</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {liveData?.total ?? 0} portfolio · {liveData?.totalOnSwitch ?? 0} total on switch · auto-refresh 15 s
          </p>
        </div>
        <span className="text-emerald-400 text-xs font-semibold">{connected} connected</span>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          data-testid="input-ws-live-search"
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter CLI, CLD, client, country…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border/60 bg-muted/30 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="rounded-xl border border-border/50 bg-card/40 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/20">
              {['Client', 'CLI', 'CLD', 'Destination', 'Duration', 'Status', 'Vendor'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {searched.length === 0 && (
              <tr><td colSpan={7} className="text-center py-10 text-xs text-muted-foreground">
                {allCalls.length === 0 ? 'No active calls in your portfolio.' : `No calls match "${search}".`}
              </td></tr>
            )}
            {searched.map((c, i) => (
              <tr key={`${c.cli}-${c.cld}-${i}`} data-testid={`row-ws-call-${i}`}
                className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}
              >
                <td className="px-3 py-2 text-xs font-medium">{c.clientName ?? `Acct.${c.accountId ?? '—'}`}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{c.cli ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{c.cld ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[120px]">{c.destFull ?? c.destCountry ?? '—'}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{fmtDuration(c.duration)}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold uppercase ${c.callStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {c.callStatus}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[100px]">{c.vendor ?? c.connection ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Section: Live Traffic (CH-3 · BitsEye2-style) ────────────────────────────

interface AccountTrafficSummary {
  accountId:      string;
  clientName:     string;
  liveCallCount:  number;
  connectedCalls: number;
  routingCalls:   number;
  topDestinations: { country: string; count: number }[];
  avgDuration:    number;
}

interface LiveTrafficResp {
  accounts:            AccountTrafficSummary[];
  totalPortfolioCalls: number;
  uniqueDestinations:  number;
  scopeError:          string | null;
  orgRole:             string | null;
  lastUpdated:         number | null;
}

type TrafficSort = 'live' | 'name' | 'health';

function LiveTrafficSection() {
  const { portfolio, portfolioMap } = useCommercialWorkspace();
  const [search, setSearch] = useState('');
  const [sort,   setSort  ] = useState<TrafficSort>('live');

  const q = useQuery<LiveTrafficResp>({
    queryKey:       ['/api/commercial/live-traffic'],
    staleTime:      10_000,
    refetchInterval: 15_000,
  });

  const traffic = q.data;

  // Merge: traffic accounts (have live data) + portfolio (have health/state)
  // Zero-call accounts from portfolio are shown as "idle"
  const merged = useMemo(() => {
    if (!traffic) return [];

    const trafficMap = new Map(traffic.accounts.map(a => [a.accountId, a]));

    // All accounts that appear in either source
    const allIds = new Set([
      ...traffic.accounts.map(a => a.accountId),
      ...portfolio.map(a => a.accountId),
    ]);

    return [...allIds].map(id => {
      const t = trafficMap.get(id);
      const p = portfolioMap.get(id);
      return {
        accountId:      id,
        clientName:     t?.clientName ?? p?.clientName ?? `Account ${id}`,
        liveCallCount:  t?.liveCallCount  ?? 0,
        connectedCalls: t?.connectedCalls ?? 0,
        routingCalls:   t?.routingCalls   ?? 0,
        topDestinations: t?.topDestinations ?? [],
        avgDuration:    t?.avgDuration ?? 0,
        healthScore:    p?.healthScore ?? null,
        state:          p?.state       ?? 'unknown',
        revenue24h:     p?.revenue24h  ?? 0,
        trendDirection: p?.trendDirection ?? 'stable',
      };
    });
  }, [traffic, portfolio, portfolioMap]);

  const filtered = useMemo(() => {
    let arr = search
      ? merged.filter(a => a.clientName.toLowerCase().includes(search.toLowerCase()) || a.accountId.includes(search))
      : merged;

    if (sort === 'live')   return [...arr].sort((a, b) => b.liveCallCount - a.liveCallCount);
    if (sort === 'health') return [...arr].sort((a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0));
    return [...arr].sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [merged, search, sort]);

  const totalCalls = traffic?.totalPortfolioCalls ?? 0;
  const activeAccounts = merged.filter(a => a.liveCallCount > 0).length;

  return (
    <div className="space-y-4">
      {/* Header + KPIs */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold">Live Traffic</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Portfolio-first · per-account breakdown · BitsEye2 integration
          </p>
        </div>
        <Link
          href="/bitseye2"
          className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 border border-sky-500/30 rounded-lg px-2.5 py-1.5 hover:bg-sky-500/10 transition-colors"
        >
          <ExternalLink className="w-3 h-3" /> Full BitsEye2
        </Link>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Portfolio Calls', value: totalCalls,    color: 'text-emerald-400', icon: Phone    },
          { label: 'Active Accounts', value: activeAccounts, color: 'text-sky-400',    icon: Activity },
          { label: 'Destinations',    value: traffic?.uniqueDestinations ?? 0, color: 'text-violet-400', icon: Globe },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center gap-3">
            <k.icon className={`w-4 h-4 shrink-0 ${k.color}`} />
            <div>
              <div className="text-xl font-bold tabular-nums">{k.value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter accounts…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border/60 bg-muted/30 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border/50 p-0.5 bg-muted/20">
          {(['live', 'health', 'name'] as TrafficSort[]).map(s => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium capitalize ${
                sort === s ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s === 'live' ? 'Live' : s === 'health' ? 'Health' : 'A-Z'}
            </button>
          ))}
        </div>
        {q.isFetching && <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />}
      </div>

      {/* Account cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {q.isLoading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/30 bg-card/30 p-4 h-28 animate-pulse" />
        ))}

        {!q.isLoading && filtered.map(a => {
          const isActive   = a.liveCallCount > 0;
          const connPct    = a.liveCallCount > 0 ? Math.round((a.connectedCalls / a.liveCallCount) * 100) : 0;
          const totalForBar = Math.max(a.liveCallCount, 1);

          return (
            <div
              key={a.accountId}
              data-testid={`card-traffic-${a.accountId}`}
              className={`rounded-xl border bg-card/60 p-4 space-y-3 hover:bg-card/80 transition-colors ${
                isActive ? 'border-emerald-500/20' : 'border-border/40'
              }`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate leading-tight">{a.clientName}</div>
                  <div className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">#{a.accountId}</div>
                </div>
                <StateBadge state={a.state} />
              </div>

              {/* Live call count + breakdown */}
              <div className="flex items-end justify-between">
                <div className="flex items-center gap-2">
                  {isActive
                    ? <Wifi    className="w-4 h-4 text-emerald-400 shrink-0" />
                    : <WifiOff className="w-4 h-4 text-muted-foreground/30 shrink-0" />
                  }
                  <div>
                    <div className={`text-2xl font-bold tabular-nums leading-none ${isActive ? 'text-emerald-400' : 'text-muted-foreground/30'}`}>
                      {a.liveCallCount}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">live calls</div>
                  </div>
                </div>

                {isActive && (
                  <div className="text-right space-y-0.5">
                    <div className="text-[10px] text-emerald-400 tabular-nums">{a.connectedCalls} conn</div>
                    <div className="text-[10px] text-amber-400 tabular-nums">{a.routingCalls} routing</div>
                    <div className="text-[10px] text-muted-foreground/60">avg {fmtDuration(a.avgDuration)}</div>
                  </div>
                )}
              </div>

              {/* Connected/routing bar */}
              {isActive && (
                <div className="w-full h-1 rounded-full bg-muted/40 overflow-hidden">
                  <div className="h-full flex">
                    <div className="bg-emerald-500 h-full" style={{ width: `${connPct}%`      }} />
                    <div className="bg-amber-500  h-full" style={{ width: `${100 - connPct}%` }} />
                  </div>
                </div>
              )}

              {/* Top destinations */}
              {a.topDestinations.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {a.topDestinations.map(d => (
                    <span key={d.country} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted/40 text-[10px] text-muted-foreground border border-border/30">
                      <Globe className="w-2.5 h-2.5 text-violet-400/70" />
                      {d.country} <span className="text-muted-foreground/60">{d.count}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Health bar (from portfolio) */}
              <HealthBar score={a.healthScore} />
            </div>
          );
        })}

        {!q.isLoading && filtered.length === 0 && (
          <div className="col-span-3 py-12 text-center text-xs text-muted-foreground">
            {search ? `No accounts match "${search}".` : 'No accounts in scope.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section: Balance ─────────────────────────────────────────────────────────
// Uses /api/commercial/balance — server-side scope filtered (mirrors Live Calls)

interface CommercialBalanceAccount {
  iAccount:    number;
  name:        string;
  balance:     number;
  creditLimit: number | null;
  balanceFlag: 'low' | 'ok';
  blocked:     boolean;
}

interface CommercialBalanceResp {
  accounts:     CommercialBalanceAccount[];
  total:        number;
  totalBalance: number;
  lowCount:     number;
  scopeError:   string | null;
  orgRole:      string | null;
}

function BalanceSection() {
  const q = useQuery<CommercialBalanceResp>({
    queryKey: ['/api/commercial/balance'],
    staleTime: 60_000,
  });

  const data     = q.data;
  const accounts = data?.accounts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold">Balance</h3>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Read-only · server-scoped · {data?.total ?? 0} accounts
          </p>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <div className="text-lg font-bold text-emerald-400">${(data?.totalBalance ?? 0).toFixed(2)}</div>
            <div className="text-[10px] text-muted-foreground">Total portfolio balance</div>
          </div>
          {(data?.lowCount ?? 0) > 0 && (
            <div>
              <div className="text-lg font-bold text-red-400">{data!.lowCount}</div>
              <div className="text-[10px] text-muted-foreground">Low balance</div>
            </div>
          )}
        </div>
      </div>

      {(data?.lowCount ?? 0) > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {data!.lowCount} account{data!.lowCount > 1 ? 's' : ''} below 10% of credit limit — review required.
        </div>
      )}

      {data?.scopeError && <ScopeAlertInline error={data.scopeError} />}

      <div className="rounded-xl border border-border/50 bg-card/40 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/20">
              {['Account', 'Acct ID', 'Balance', 'Credit Limit', 'Utilisation', 'Status'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr><td colSpan={6} className="text-center py-10 text-xs text-muted-foreground">
                <Activity className="w-4 h-4 animate-pulse mx-auto mb-1" />Loading…
              </td></tr>
            )}
            {!q.isLoading && accounts.map((a, i) => {
              const util = a.creditLimit ? Math.min(100, Math.round((1 - a.balance / a.creditLimit) * 100)) : null;
              return (
                <tr key={a.iAccount} className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                  <td className="px-3 py-2 text-xs font-medium">
                    <div className="flex items-center gap-1.5">
                      {a.blocked && <span className="text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/30 px-1 rounded">BLOCKED</span>}
                      {a.name}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{a.iAccount}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold tabular-nums ${a.balanceFlag === 'low' ? 'text-red-400' : 'text-emerald-400'}`}>
                      ${a.balance.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                    {a.creditLimit != null ? `$${a.creditLimit.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {util !== null ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-14 h-1.5 rounded-full bg-muted/40">
                          <div className={`h-full rounded-full ${util > 90 ? 'bg-red-500' : util > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${util}%` }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{util}%</span>
                      </div>
                    ) : <span className="text-muted-foreground/30 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {a.balanceFlag === 'low'
                      ? <span className="text-[10px] font-semibold text-red-400    uppercase tracking-wider">Low</span>
                      : <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">OK</span>
                    }
                  </td>
                </tr>
              );
            })}
            {!q.isLoading && accounts.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-xs text-muted-foreground">No balance data in scope.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Section: Products ─────────────────────────────────────────────────────────
// Tabs: Rate Analysis · Push History · Send Rate

type ProductsTab = 'analysis' | 'history' | 'send';

interface RatePushJob {
  id:           number;
  status:       string;
  iAccount?:    number;
  clientName?:  string;
  createdAt?:   string;
  completedAt?: string;
  totalRates?:  number;
  pushedRates?: number;
  failedRates?: number;
}

interface RateKpi {
  totalCountries:    number;
  totalDestinations: number;
  totalClients:      number;
  totalProducts:     number;
}

interface Product {
  id:          number;
  name:        string;
  status:      string;
  productClass?: string;
  trunkPrefix?: string;
  description?: string;
}

function ProductsSection() {
  const { portfolio } = useCommercialWorkspace();
  const [tab, setTab] = useState<ProductsTab>('analysis');
  const [jobSearch, setJobSearch] = useState('');

  const kpiQ  = useQuery<RateKpi>({ queryKey: ['/api/rate-manager/kpi'],      staleTime: 60_000 });
  const prodsQ = useQuery<Product[]>({ queryKey: ['/api/rate-manager/products'], staleTime: 60_000 });
  const jobsQ  = useQuery<{ jobs: RatePushJob[] }>({ queryKey: ['/api/rate-manager/jobs'], staleTime: 30_000 });

  const kpi     = kpiQ.data;
  const products = prodsQ.data ?? [];
  const allJobs  = jobsQ.data?.jobs ?? [];

  const filteredJobs = useMemo(() => {
    if (!jobSearch.trim()) return allJobs;
    const lq = jobSearch.toLowerCase();
    return allJobs.filter(j =>
      (j.clientName ?? '').toLowerCase().includes(lq) ||
      String(j.iAccount ?? '').includes(lq) ||
      j.status.includes(lq)
    );
  }, [allJobs, jobSearch]);

  const completedJobs  = allJobs.filter(j => j.status === 'completed').length;
  const failedJobs     = allJobs.filter(j => j.status === 'failed').length;
  const pendingJobs    = allJobs.filter(j => ['pending', 'running'].includes(j.status)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold">Products</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Rate analysis · push history · send rates to Sippy</p>
        </div>
        <Link href="/rate-manager" className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 border border-sky-500/30 rounded-lg px-2.5 py-1.5 hover:bg-sky-500/10 transition-colors">
          Full Rate Manager <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-lg border border-border/50 p-0.5 bg-muted/20 w-fit">
        {([
          ['analysis', 'Rate Analysis', BarChart2 ],
          ['history',  'Push History',  Clock     ],
          ['send',     'Send Rate',     TrendingUp],
        ] as [ProductsTab, string, any][]).map(([id, label, Icon]) => (
          <button
            key={id}
            data-testid={`tab-products-${id}`}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors font-medium ${
              tab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-3 h-3" />{label}
          </button>
        ))}
      </div>

      {/* ── Tab: Rate Analysis ── */}
      {tab === 'analysis' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Countries',    value: kpi?.totalCountries    ?? '—', icon: Globe,       color: 'text-violet-400' },
              { label: 'Destinations', value: kpi?.totalDestinations ?? '—', icon: Activity,    color: 'text-sky-400'    },
              { label: 'Clients',      value: kpi?.totalClients      ?? '—', icon: Users,       color: 'text-emerald-400'},
              { label: 'Products',     value: kpi?.totalProducts     ?? '—', icon: Layers,      color: 'text-amber-400'  },
            ].map(k => (
              <div key={k.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center gap-3">
                <k.icon className={`w-4 h-4 shrink-0 ${k.color}`} />
                <div>
                  <div className="text-xl font-bold tabular-nums">{k.value}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Commercial Products</h4>
            <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {['Product', 'Class', 'Prefix', 'Status'].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {prodsQ.isLoading && (
                    <tr><td colSpan={4} className="text-center py-8 text-xs text-muted-foreground"><Activity className="w-4 h-4 animate-pulse mx-auto mb-1" />Loading…</td></tr>
                  )}
                  {!prodsQ.isLoading && products.map((p, i) => (
                    <tr key={p.id} className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                      <td className="px-3 py-2 text-xs font-medium">{p.name}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded">{p.productClass ?? '—'}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{p.trunkPrefix ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                          p.status === 'commercial' ? 'text-emerald-400' :
                          p.status === 'testing'    ? 'text-amber-400'   : 'text-muted-foreground'
                        }`}>{p.status}</span>
                      </td>
                    </tr>
                  ))}
                  {!prodsQ.isLoading && products.length === 0 && (
                    <tr><td colSpan={4} className="text-center py-8 text-xs text-muted-foreground">No commercial products configured.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Push History ── */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-3">
              {[
                { label: 'Completed', value: completedJobs, color: 'text-emerald-400' },
                { label: 'Failed',    value: failedJobs,    color: 'text-red-400'     },
                { label: 'Pending',   value: pendingJobs,   color: 'text-amber-400'   },
              ].map(s => (
                <div key={s.label} className="rounded-lg border border-border/40 bg-card/50 px-3 py-1.5 text-center">
                  <div className={`text-base font-bold tabular-nums ${s.color}`}>{s.value}</div>
                  <div className="text-[10px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                data-testid="input-job-search"
                value={jobSearch} onChange={e => setJobSearch(e.target.value)}
                placeholder="Filter by client, status…"
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border/60 bg-muted/30 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {['Job ID', 'Client', 'Status', 'Rates (done/total)', 'Created', 'Completed'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobsQ.isLoading && (
                  <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground"><Activity className="w-4 h-4 animate-pulse mx-auto mb-1" />Loading…</td></tr>
                )}
                {!jobsQ.isLoading && filteredJobs.slice(0, 20).map((j, i) => (
                  <tr key={j.id} className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">#{j.id}</td>
                    <td className="px-3 py-2 text-xs font-medium">{j.clientName ?? `Acct.${j.iAccount ?? '—'}`}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                        j.status === 'completed' ? 'text-emerald-400' :
                        j.status === 'failed'    ? 'text-red-400'     :
                        j.status === 'running'   ? 'text-sky-400'     : 'text-amber-400'
                      }`}>{j.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {j.pushedRates ?? 0}/{j.totalRates ?? '—'}
                        </span>
                        {j.totalRates && j.pushedRates != null && (
                          <div className="w-12 h-1 rounded-full bg-muted/40">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((j.pushedRates / j.totalRates) * 100)}%` }} />
                          </div>
                        )}
                        {(j.failedRates ?? 0) > 0 && (
                          <span className="text-[10px] text-red-400">{j.failedRates} failed</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                      {j.createdAt ? new Date(j.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                      {j.completedAt ? new Date(j.completedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
                {!jobsQ.isLoading && filteredJobs.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground">No push jobs found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Send Rate ── */}
      {tab === 'send' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-300/80 leading-relaxed">
              Rate push is a privileged operation. Rates are pushed directly to Sippy tariffs assigned to portfolio accounts.
              Use the full Rate Manager for batch operations, preview, and advanced configuration.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: 'Push Rates to Account', desc: 'Send a specific rate to one or more portfolio accounts. Select destination prefix, rate, and effective date.', action: 'rate-manager', cta: 'Open Rate Push →' },
              { label: 'Analyse Rate Coverage', desc: 'Review which destinations have rates assigned and identify gaps across the portfolio.', action: 'rate-manager', cta: 'Open Rate Analysis →' },
            ].map(item => (
              <Link key={item.label} href={`/${item.action}`}>
                <div className="rounded-xl border border-border/50 bg-card/60 p-5 hover:bg-card/80 hover:border-sky-500/30 transition-colors cursor-pointer group">
                  <div className="text-sm font-semibold mb-2">{item.label}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed mb-4">{item.desc}</div>
                  <div className="text-xs text-sky-400 font-medium group-hover:underline">{item.cta}</div>
                </div>
              </Link>
            ))}
          </div>

          <div className="rounded-xl border border-border/50 bg-card/40 p-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Portfolio Rate Coverage Snapshot</div>
            <div className="space-y-2">
              {portfolio.slice(0, 8).map(a => (
                <div key={a.accountId} className="flex items-center justify-between py-1 border-b border-border/20">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                    <span className="text-xs">{a.clientName}</span>
                    <span className="font-mono text-[10px] text-muted-foreground/50">#{a.accountId}</span>
                  </div>
                  <span className={`text-[10px] font-semibold uppercase ${
                    a.state === 'healthy' ? 'text-emerald-400' :
                    a.state === 'at_risk' ? 'text-red-400'     : 'text-amber-400'
                  }`}>{a.state.replace('_', ' ')}</span>
                </div>
              ))}
              {portfolio.length > 8 && (
                <div className="text-[10px] text-muted-foreground/50 pt-1">+{portfolio.length - 8} more accounts in portfolio</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section: Reports ─────────────────────────────────────────────────────────
// Inline portfolio data views — stay within the workspace

type ReportsTab = 'revenue' | 'traffic' | 'pnl';

function ReportsSection() {
  const { portfolio, kpis } = useCommercialWorkspace();
  const [tab, setTab] = useState<ReportsTab>('revenue');

  const byRevenue = useMemo(
    () => [...portfolio].sort((a, b) => (b.revenue24h ?? 0) - (a.revenue24h ?? 0)),
    [portfolio],
  );

  const byCalls = useMemo(
    () => [...portfolio].sort((a, b) => (b.calls24h ?? 0) - (a.calls24h ?? 0)),
    [portfolio],
  );

  const totalRev  = portfolio.reduce((s, a) => s + (a.revenue24h  ?? 0), 0);
  const totalCalls = portfolio.reduce((s, a) => s + (a.calls24h ?? 0), 0);
  const growing   = portfolio.filter(a => a.trendDirection === 'up').length;
  const declining = portfolio.filter(a => a.trendDirection === 'down').length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold">Reports</h3>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Read-only · portfolio-scoped · data from context
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-lg border border-border/50 p-0.5 bg-muted/20 w-fit">
        {([
          ['revenue', 'Revenue',  DollarSign],
          ['traffic', 'Traffic',  Activity  ],
          ['pnl',     'P & L',    BarChart2  ],
        ] as [ReportsTab, string, any][]).map(([id, label, Icon]) => (
          <button
            key={id}
            data-testid={`tab-reports-${id}`}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors font-medium ${
              tab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-3 h-3" />{label}
          </button>
        ))}
      </div>

      {/* ── Revenue tab ── */}
      {tab === 'revenue' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '24h Revenue',     value: `$${totalRev.toFixed(2)}`,   color: 'text-violet-400' },
              { label: 'Growing Accts',   value: growing,                      color: 'text-emerald-400'},
              { label: 'Declining Accts', value: declining,                    color: 'text-red-400'    },
            ].map(k => (
              <div key={k.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3">
                <div className={`text-xl font-bold tabular-nums ${k.color}`}>{k.value}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top Accounts by 24h Revenue</span>
              <Link href="/revenue-heatmap" className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 transition-colors">
                Full Report <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {['Account', 'Acct ID', '24h Revenue', 'Trend', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byRevenue.slice(0, 15).map((a, i) => (
                  <tr key={a.accountId} className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                    <td className="px-3 py-2 text-xs font-medium">{a.clientName}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{a.accountId}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-semibold text-violet-400 tabular-nums">${(a.revenue24h ?? 0).toFixed(2)}</span>
                    </td>
                    <td className="px-3 py-2"><TrendIcon dir={a.trendDirection} /></td>
                    <td className="px-3 py-2"><StateBadge state={a.state} /></td>
                  </tr>
                ))}
                {byRevenue.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-xs text-muted-foreground">No revenue data available.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Traffic tab ── */}
      {tab === 'traffic' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '24h Calls',    value: totalCalls,                    color: 'text-sky-400'     },
              { label: 'Active Accts', value: portfolio.filter(a => (a.calls24h ?? 0) > 0).length, color: 'text-emerald-400' },
              { label: 'Silent Accts', value: portfolio.filter(a => (a.calls24h ?? 0) === 0).length, color: 'text-amber-400' },
            ].map(k => (
              <div key={k.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3">
                <div className={`text-xl font-bold tabular-nums ${k.color}`}>{k.value}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Traffic by Account · Last 24h</span>
              <Link href="/traffic-forecast" className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 transition-colors">
                Forecast <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {['Account', 'Calls 24h', 'Live', 'Trend', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byCalls.slice(0, 15).map((a, i) => (
                  <tr key={a.accountId} className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                    <td className="px-3 py-2 text-xs font-medium">{a.clientName}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-semibold text-sky-400 tabular-nums">{a.calls24h ?? 0}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-semibold tabular-nums ${(a.liveCallCount ?? 0) > 0 ? 'text-emerald-400' : 'text-muted-foreground/30'}`}>
                        {a.liveCallCount ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2"><TrendIcon dir={a.trendDirection} /></td>
                    <td className="px-3 py-2"><StateBadge state={a.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── P&L tab ── */}
      {tab === 'pnl' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border/40 bg-muted/10 px-4 py-3 flex items-start gap-3">
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground/80 leading-relaxed">
              Detailed P&L data — including cost, margin, and vendor breakdown — is available in the full Analytics suite.
              Portfolio-level margin calculations require the Finance snapshot pipeline.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: 'Analytics — P&L',    desc: 'Full P&L breakdown by account, route, and vendor. Includes cost, margin, and revenue analysis.',  href: '/analytics',        icon: BarChart2,   color: 'text-emerald-400' },
              { label: 'Finance Cockpit',     desc: 'Invoice batches, reconciliation, margin snapshots, and financial health across the portfolio.',     href: '/finance-cockpit',  icon: DollarSign,  color: 'text-violet-400'  },
            ].map(r => (
              <Link key={r.label} href={r.href}>
                <div className="rounded-xl border border-border/50 bg-card/60 p-5 hover:bg-card/80 transition-colors cursor-pointer group">
                  <r.icon className={`w-4 h-4 mb-2 ${r.color}`} />
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.desc}</div>
                  <div className="flex items-center gap-1 mt-3 text-xs text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    Open <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue vs Traffic — 24h Snapshot</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {['Account', 'Revenue 24h', 'Calls 24h', 'Rev / Call', 'Trend'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byRevenue.slice(0, 10).map((a, i) => {
                  const revPerCall = (a.calls24h ?? 0) > 0 ? (a.revenue24h ?? 0) / a.calls24h! : null;
                  return (
                    <tr key={a.accountId} className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                      <td className="px-3 py-2 text-xs font-medium">{a.clientName}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-violet-400 tabular-nums">${(a.revenue24h ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-xs text-sky-400 tabular-nums">{a.calls24h ?? 0}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                        {revPerCall != null ? `$${revPerCall.toFixed(3)}` : '—'}
                      </td>
                      <td className="px-3 py-2"><TrendIcon dir={a.trendDirection} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared scope alert (inline variant) ───────────────────────────────────────
function ScopeAlertInline({ error }: { error: string }) {
  const msg = error === 'sippy_not_configured'
    ? 'Sippy is not configured. Contact your administrator.'
    : error === 'no_kam_link'
      ? 'Your account is not linked to a KAM profile.'
      : 'No accounts in scope.';
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      {msg}
    </div>
  );
}

// ── Sprint B: Portfolio Intelligence ─────────────────────────────────────────
//
// Goal: KAM opens workspace and understands portfolio health in ≤ 60 seconds.
// Layout: 2×2 panel grid (Traffic · Quality · Risk · Commercial) — all visible
// at once, no tabs. Risk + Commercial panels derive from the shared portfolio
// context so no extra round-trips are needed.
//
// Backend endpoint: GET /api/commercial/intelligence
//   hourlyTrend   — concurrent_snapshots (dim=client, last 24h by hour)
//   qualityMetrics— mos_hourly + rtp_quality_history (24h aggregate + trend)
//   revenueTrend  — financial_snapshot (7d, scope-filtered)

interface HourlyPoint  { hour: string; calls: number }
interface RevPoint     { date: string; revenue: number; margin: number }
interface QualityMeta  {
  avgMos:     number | null;
  avgJitter:  number | null;
  avgPktLoss: number | null;
  callCount:  number;
  trend:      'improving' | 'stable' | 'declining';
}
interface IntelResp {
  hourlyTrend:    HourlyPoint[];
  qualityMetrics: QualityMeta | null;
  revenueTrend:   RevPoint[];
  scopeError:     string | null;
  orgRole:        string | null;
  scoredAt:       string;
}

// ── Inline SVG sparkline (no external library) ─────────────────────────────
function Sparkline({ data, color = 'currentColor', h = 36, w = 160 }: {
  data:  number[];
  color?: string;
  h?:    number;
  w?:    number;
}) {
  if (data.length < 2) {
    return <div className="rounded bg-muted/20" style={{ width: w, height: h }} />;
  }
  const max = Math.max(...data, 1);
  const pad = 2;
  const pts = data.map((v, i) =>
    `${pad + (i / (data.length - 1)) * (w - pad * 2)},${h - pad - ((v / max) * (h - pad * 2))}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── MOS quality colour helper ──────────────────────────────────────────────
function mosColor(mos: number | null) {
  if (mos === null)  return 'text-muted-foreground';
  if (mos >= 4.0)    return 'text-emerald-400';
  if (mos >= 3.5)    return 'text-sky-400';
  if (mos >= 3.0)    return 'text-amber-400';
  return 'text-red-400';
}

function IntelligenceSection() {
  const { portfolio } = useCommercialWorkspace();

  const intel = useQuery<IntelResp>({
    queryKey: ['/api/commercial/intelligence'],
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const data = intel.data;

  // ── Derived from portfolio context (no extra round-trip) ──────────────────
  const byVolume   = useMemo(() => [...portfolio].sort((a, b) => (b.calls24h ?? 0) - (a.calls24h ?? 0)), [portfolio]);
  const byRevenue  = useMemo(() => [...portfolio].sort((a, b) => (b.revenue24h ?? 0) - (a.revenue24h ?? 0)), [portfolio]);
  const growing    = useMemo(() => portfolio.filter(a => a.trendDirection === 'up'),   [portfolio]);
  const declining  = useMemo(() => portfolio.filter(a => a.trendDirection === 'down'), [portfolio]);

  const riskFlags = useMemo(() => {
    const flags: Array<{ accountId: string; name: string; reasons: string[] }> = [];
    portfolio.forEach(a => {
      const r: string[] = [];
      if ((a.calls24h   ?? 0) === 0)             r.push('zero_traffic');
      if (a.state === 'at_risk')                  r.push('at_risk');
      if (a.state === 'degraded')                 r.push('degraded');
      if (a.trendDirection === 'down')            r.push('declining');
      if (r.length) flags.push({ accountId: a.accountId, name: a.clientName, reasons: r });
    });
    return flags;
  }, [portfolio]);

  const hourlyValues = (data?.hourlyTrend ?? []).map(p => p.calls);
  const peakCalls    = hourlyValues.length ? Math.max(...hourlyValues) : 0;

  const revValues    = (data?.revenueTrend ?? []).map(p => p.revenue);
  const totalRev7d   = revValues.reduce((s, v) => s + v, 0);

  const qm = data?.qualityMetrics;

  const REASON_LABEL: Record<string, string> = {
    zero_traffic: 'No Traffic',
    at_risk:      'At Risk',
    degraded:     'Degraded',
    declining:    'Declining',
  };
  const REASON_COLOR: Record<string, string> = {
    zero_traffic: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
    at_risk:      'text-red-400 bg-red-500/10 border-red-500/30',
    degraded:     'text-amber-400 bg-amber-500/10 border-amber-500/30',
    declining:    'text-orange-400 bg-orange-500/10 border-orange-500/30',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Gauge className="w-4 h-4 text-emerald-400" />
            Portfolio Intelligence
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            60-second morning brief · {portfolio.length} accounts in scope
            {data?.scoredAt && (
              <span className="ml-2 text-muted-foreground/50">
                · updated {new Date(data.scoredAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        {intel.isFetching && (
          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* 2×2 Panel grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── Panel 1: Traffic ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-sky-400" />
              <span className="text-sm font-semibold">Traffic</span>
            </div>
            <div className="text-right">
              <div className="text-base font-bold tabular-nums text-sky-400">{peakCalls}</div>
              <div className="text-[10px] text-muted-foreground">peak concurrent (24h)</div>
            </div>
          </div>

          {/* Hourly trend sparkline */}
          <div className="rounded-lg bg-muted/20 px-3 py-2">
            <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">Hourly call trend · last 24h</div>
            {intel.isLoading
              ? <div className="h-9 animate-pulse bg-muted/30 rounded" />
              : <Sparkline data={hourlyValues} color="rgb(56,189,248)" h={36} w={240} />
            }
          </div>

          {/* Top accounts by volume */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Top by 24h calls</div>
            <div className="space-y-1.5">
              {byVolume.slice(0, 5).map(a => {
                const maxCalls = byVolume[0]?.calls24h ?? 1;
                const pct = maxCalls > 0 ? Math.round(((a.calls24h ?? 0) / maxCalls) * 100) : 0;
                return (
                  <div key={a.accountId} className="flex items-center gap-2">
                    <div className="text-xs truncate w-32 shrink-0">{a.clientName}</div>
                    <div className="flex-1 h-1.5 rounded-full bg-muted/30">
                      <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-xs tabular-nums text-muted-foreground w-10 text-right">{a.calls24h ?? 0}</div>
                    <TrendIcon dir={a.trendDirection} />
                  </div>
                );
              })}
              {byVolume.length === 0 && <div className="text-xs text-muted-foreground">No traffic data.</div>}
            </div>
          </div>
        </div>

        {/* ── Panel 2: Quality ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Signal className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-semibold">Quality</span>
            </div>
            {qm && (
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${
                qm.trend === 'improving' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
                qm.trend === 'declining' ? 'text-red-400 bg-red-500/10 border-red-500/30' :
                'text-muted-foreground bg-muted/20 border-border/40'
              }`}>
                {qm.trend}
              </span>
            )}
          </div>

          {/* MOS KPIs */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Avg MOS',   value: qm?.avgMos     != null ? qm.avgMos.toFixed(2)    : null, unit: '',   color: mosColor(qm?.avgMos ?? null) },
              { label: 'Jitter',    value: qm?.avgJitter  != null ? qm.avgJitter.toFixed(1)  : null, unit: 'ms', color: 'text-foreground' },
              { label: 'Pkt Loss',  value: qm?.avgPktLoss != null ? qm.avgPktLoss.toFixed(2) : null, unit: '%',  color: qm?.avgPktLoss != null && qm.avgPktLoss > 2 ? 'text-red-400' : 'text-foreground' },
            ].map(k => (
              <div key={k.label} className="rounded-lg bg-muted/20 px-3 py-2.5 text-center">
                {intel.isLoading
                  ? <div className="h-5 animate-pulse bg-muted/30 rounded mx-2 mb-1" />
                  : <div className={`text-lg font-bold tabular-nums ${k.color}`}>
                      {k.value != null ? `${k.value}${k.unit}` : '—'}
                    </div>
                }
                <div className="text-[10px] text-muted-foreground mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          {/* MOS quality scale */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Quality reference</div>
            <div className="flex rounded-lg overflow-hidden h-2">
              {[
                { color: 'bg-red-500',     w: '20%' },
                { color: 'bg-amber-500',   w: '15%' },
                { color: 'bg-yellow-500',  w: '15%' },
                { color: 'bg-sky-500',     w: '20%' },
                { color: 'bg-emerald-500', w: '30%' },
              ].map((s, i) => <div key={i} className={`h-full ${s.color}`} style={{ width: s.w }} />)}
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
              <span>1.0 · Critical</span><span>3.0 · Acceptable</span><span>4.5 · Excellent</span>
            </div>
          </div>

          {/* Calls sampled */}
          <div className="text-[10px] text-muted-foreground">
            {qm?.callCount != null ? `${qm.callCount.toLocaleString()} calls sampled in last 24h` : intel.isLoading ? 'Loading…' : 'No quality data collected yet'}
          </div>
        </div>

        {/* ── Panel 3: Risk ──────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold">Risk</span>
            </div>
            <div className="flex gap-2 text-right">
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-2 py-1">
                <div className="text-base font-bold text-red-400 tabular-nums">{riskFlags.length}</div>
                <div className="text-[9px] text-red-400/70">flagged</div>
              </div>
            </div>
          </div>

          {riskFlags.length === 0 ? (
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="text-xs text-emerald-400">All accounts are healthy — no risk flags detected.</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {riskFlags.map(f => (
                <div key={f.accountId} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/20">
                  <div className="flex items-center gap-2 min-w-0">
                    <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                    <span className="text-xs font-medium truncate">{f.name}</span>
                    <span className="font-mono text-[9px] text-muted-foreground/50 shrink-0">#{f.accountId}</span>
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {f.reasons.map(r => (
                      <span key={r} className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border whitespace-nowrap ${REASON_COLOR[r] ?? 'text-muted-foreground bg-muted/20 border-border/40'}`}>
                        {REASON_LABEL[r] ?? r}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Risk summary counts */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Zero traffic',   count: portfolio.filter(a => (a.calls24h ?? 0) === 0).length,               color: 'text-slate-400' },
              { label: 'Declining',      count: declining.length,                                                      color: 'text-orange-400' },
              { label: 'At risk / deg.', count: portfolio.filter(a => ['at_risk','degraded'].includes(a.state)).length,color: 'text-red-400'   },
              { label: 'Growing',        count: growing.length,                                                        color: 'text-emerald-400'},
            ].map(k => (
              <div key={k.label} className="rounded-lg bg-muted/20 px-3 py-1.5 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">{k.label}</span>
                <span className={`text-sm font-bold tabular-nums ${k.color}`}>{k.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Panel 4: Commercial ────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold">Commercial</span>
            </div>
            <div className="text-right">
              <div className="text-base font-bold tabular-nums text-emerald-400">${totalRev7d.toFixed(0)}</div>
              <div className="text-[10px] text-muted-foreground">revenue · last 7d</div>
            </div>
          </div>

          {/* 7-day revenue sparkline */}
          <div className="rounded-lg bg-muted/20 px-3 py-2">
            <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">Revenue trend · last 7d</div>
            {intel.isLoading
              ? <div className="h-9 animate-pulse bg-muted/30 rounded" />
              : revValues.length > 0
                ? <Sparkline data={revValues} color="rgb(52,211,153)" h={36} w={240} />
                : <div className="h-9 flex items-center justify-center text-[10px] text-muted-foreground/40">No financial snapshot data</div>
            }
          </div>

          {/* Top accounts by revenue */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Top by 24h revenue</div>
            <div className="space-y-1.5">
              {byRevenue.slice(0, 4).map(a => {
                const maxRev = byRevenue[0]?.revenue24h ?? 1;
                const pct = maxRev > 0 ? Math.round(((a.revenue24h ?? 0) / maxRev) * 100) : 0;
                return (
                  <div key={a.accountId} className="flex items-center gap-2">
                    <div className="text-xs truncate w-32 shrink-0">{a.clientName}</div>
                    <div className="flex-1 h-1.5 rounded-full bg-muted/30">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-xs tabular-nums text-emerald-400 w-16 text-right">${(a.revenue24h ?? 0).toFixed(0)}</div>
                  </div>
                );
              })}
              {byRevenue.length === 0 && <div className="text-xs text-muted-foreground">No revenue data.</div>}
            </div>
          </div>

          {/* Fastest growing + needs attention */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-emerald-400/70 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> Fastest growing
              </div>
              {growing.slice(0, 3).map(a => (
                <div key={a.accountId} className="text-xs text-muted-foreground truncate py-0.5">{a.clientName}</div>
              ))}
              {growing.length === 0 && <div className="text-xs text-muted-foreground/40">None</div>}
            </div>
            <div>
              <div className="text-[10px] text-amber-400/70 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <AlertCircle className="w-2.5 h-2.5" /> Needs attention
              </div>
              {riskFlags.slice(0, 3).map(f => (
                <div key={f.accountId} className="text-xs text-muted-foreground truncate py-0.5">{f.name}</div>
              ))}
              {riskFlags.length === 0 && <div className="text-xs text-muted-foreground/40">All clear</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar nav config ────────────────────────────────────────────────────────

type IconComponent = (props: LucideProps) => JSX.Element;

const SECTIONS: { id: SectionId; label: string; icon: IconComponent }[] = [
  { id: 'dashboard',     label: 'Dashboard',    icon: LayoutDashboard },
  { id: 'intelligence',  label: 'Intelligence', icon: Gauge           },
  { id: 'clients',       label: 'Clients',      icon: Users           },
  { id: 'live-calls',    label: 'Live Calls',   icon: Phone           },
  { id: 'live-traffic',  label: 'Live Traffic', icon: Activity        },
  { id: 'balance',       label: 'Balance',      icon: Wallet          },
  { id: 'products',      label: 'Products',     icon: Layers          },
  { id: 'reports',       label: 'Reports',      icon: BarChart2       },
];

// ── Inner shell (reads context) ───────────────────────────────────────────────

function WorkspaceShell() {
  const { scope, isLoading, liveCallCount, atRiskCount, clientCount } = useCommercialWorkspace();
  const [active, setActive] = useState<SectionId>('dashboard');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Activity className="w-5 h-5 animate-pulse text-muted-foreground" />
      </div>
    );
  }

  if (scope?.scopeError) {
    return (
      <div className="flex items-center justify-center h-64">
        <ScopeAlert error={scope.scopeError} />
      </div>
    );
  }

  const badges: Partial<Record<SectionId, { count: number; variant: 'risk' | 'live' | 'neutral' }>> = {
    dashboard:    atRiskCount > 0 ? { count: atRiskCount, variant: 'risk'    } : undefined,
    clients:      clientCount > 0 ? { count: clientCount, variant: 'neutral' } : undefined,
    'live-calls': liveCallCount > 0 ? { count: liveCallCount, variant: 'live' } : undefined,
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] rounded-xl border border-border/50 overflow-hidden bg-card/20">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-border/50 bg-card/60 flex flex-col">
        <div className="px-4 py-3.5 border-b border-border/40">
          <div className="text-xs font-semibold text-foreground">Commercial Portal</div>
          {scope && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {scope.isAdmin ? 'All Accounts' : (scope.orgRole ?? 'KAM')} ·{' '}
              <span className="font-semibold text-foreground">{scope.accountIds.length}</span> accts
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {SECTIONS.map(s => {
            const isActive = active === s.id;
            const badge    = badges[s.id];
            return (
              <button
                key={s.id}
                data-testid={`nav-ws-${s.id}`}
                onClick={() => setActive(s.id)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400 border-r-2 border-emerald-500'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <s.icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium">{s.label}</span>
                </div>
                {badge && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    badge.variant === 'risk'    ? 'bg-red-500/20 text-red-400'       :
                    badge.variant === 'live'    ? 'bg-emerald-500/20 text-emerald-400':
                    'bg-muted/60 text-muted-foreground'
                  }`}>{badge.count}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-border/40">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Info className="w-3 h-3 shrink-0" />
            Hierarchy-scoped · server-enforced
          </div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6">
        {active === 'dashboard'    && <DashboardSection    />}
        {active === 'intelligence' && <IntelligenceSection />}
        {active === 'clients'      && <ClientsSection      />}
        {active === 'live-calls'   && <LiveCallsSection    />}
        {active === 'live-traffic' && <LiveTrafficSection  />}
        {active === 'balance'      && <BalanceSection      />}
        {active === 'products'     && <ProductsSection     />}
        {active === 'reports'      && <ReportsSection      />}
      </main>
    </div>
  );
}

// ── Page export (provider wraps everything) ───────────────────────────────────

export default function CommercialWorkspacePage() {
  return (
    <CommercialWorkspaceProvider>
      <WorkspaceShell />
    </CommercialWorkspaceProvider>
  );
}
