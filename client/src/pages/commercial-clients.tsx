import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  Users, Search, AlertTriangle, Activity, TrendingUp,
  TrendingDown, Minus, Phone, DollarSign, ShieldAlert,
  Building2, ChevronLeft, ChevronRight, Info, Wifi, WifiOff,
} from "lucide-react";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommercialClient {
  accountId:  string;
  clientName: string;
  kamId:      number;
  kamName:    string;
  orgRole:    string | null;
}

interface CommercialClientsResponse {
  clients:    CommercialClient[];
  total:      number;
  scopeError: 'no_kam_link' | 'no_accounts' | null;
  kamIds:     number[];
  orgRole:    string | null;
}

interface PortfolioAccount {
  accountId:     string;
  clientName:    string;
  kamId:         number;
  healthScore:   number | null;
  state:         string;
  liveCallCount: number;
  calls24h:      number;
  revenue24h:    number;
  trendDirection: string;
  reasons:       string[];
}

interface PortfolioResponse {
  portfolio: PortfolioAccount[];
}

// ── State badge ───────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    healthy:    { label: 'Healthy',    cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    at_risk:    { label: 'At Risk',    cls: 'bg-red-500/15 text-red-400 border-red-500/30'             },
    degraded:   { label: 'Degraded',   cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30'       },
    no_traffic: { label: 'No Traffic', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30'       },
    unknown:    { label: 'Unknown',    cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'           },
  };
  const { label, cls } = cfg[state] ?? cfg.unknown;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${cls}`}>
      {label}
    </span>
  );
}

// ── Health score bar ──────────────────────────────────────────────────────────

function HealthBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground/50">—</span>;
  const pct  = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-muted/40">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{pct}</span>
    </div>
  );
}

// ── Trend icon ────────────────────────────────────────────────────────────────

function TrendIcon({ dir }: { dir: string }) {
  if (dir === 'up')   return <TrendingUp  className="w-3.5 h-3.5 text-emerald-400" />;
  if (dir === 'down') return <TrendingDown className="w-3.5 h-3.5 text-red-400"    />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground/50" />;
}

// ── Scope indicator ───────────────────────────────────────────────────────────

function ScopeIndicator({
  orgRole, total, scopeError, isAdmin,
}: {
  orgRole:    string | null;
  total:      number;
  scopeError: string | null;
  isAdmin:    boolean;
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
        Showing <span className="font-semibold text-foreground">{total}</span> client{total !== 1 ? 's' : ''} visible to{' '}
        <span className="font-semibold text-foreground">{roleLabel}</span> scope
        {isAdmin && ' (all accounts)'}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function CommercialClientsPage() {
  const { user } = useAuth();
  const isAdmin   = ['admin', 'super_admin'].includes((user as any)?.role ?? '');

  const [search, setSearch] = useState('');
  const [page,   setPage  ] = useState(1);

  // Debounced search passed to API
  const [apiSearch, setApiSearch] = useState('');

  function handleSearch(val: string) {
    setSearch(val);
    setPage(1);
    setApiSearch(val);
  }

  // ── Data queries ────────────────────────────────────────────────────────────

  const clientsQ = useQuery<CommercialClientsResponse>({
    queryKey: ['/api/commercial/clients', apiSearch, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (apiSearch) params.set('search', apiSearch);
      params.set('page',  String(page));
      params.set('limit', String(PAGE_SIZE));
      const res = await fetch(`/api/commercial/clients?${params}`);
      if (!res.ok) throw new Error('Failed to load clients');
      return res.json();
    },
    staleTime: 30_000,
  });

  const portfolioQ = useQuery<PortfolioResponse>({
    queryKey: ['/api/kam/portfolio'],
    staleTime: 20_000,
  });

  // ── Merge clients + portfolio live stats ────────────────────────────────────

  const statsMap = useMemo(() => {
    const map = new Map<string, PortfolioAccount>();
    for (const acc of (portfolioQ.data?.portfolio ?? [])) {
      map.set(acc.accountId, acc);
    }
    return map;
  }, [portfolioQ.data]);

  const clients    = clientsQ.data?.clients    ?? [];
  const total      = clientsQ.data?.total      ?? 0;
  const scopeError = clientsQ.data?.scopeError ?? null;
  const orgRole    = clientsQ.data?.orgRole    ?? null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const isLoading = clientsQ.isLoading;

  // ── Summary stats from portfolio ────────────────────────────────────────────
  const portfolioAccounts = portfolioQ.data?.portfolio ?? [];
  const totalLive    = portfolioAccounts.reduce((s, a) => s + (a.liveCallCount ?? 0), 0);
  const totalRev24h  = portfolioAccounts.reduce((s, a) => s + (a.revenue24h   ?? 0), 0);
  const atRisk       = portfolioAccounts.filter(a => a.state === 'at_risk' || a.state === 'degraded').length;
  const noTraffic    = portfolioAccounts.filter(a => a.state === 'no_traffic').length;

  return (
    <div className="space-y-6 p-1">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-emerald-400" />
            Portfolio Clients
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Clients visible within your hierarchy scope — hierarchy-filtered, read-only.
          </p>
        </div>
      </div>

      {/* ── Scope indicator ─────────────────────────────────────────────────── */}
      <ScopeIndicator
        orgRole={orgRole}
        total={total}
        scopeError={scopeError}
        isAdmin={isAdmin}
      />

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      {!scopeError && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Clients',  value: total,       icon: Building2,    color: 'text-sky-400'     },
            { label: 'Live Calls',     value: totalLive,   icon: Phone,        color: 'text-emerald-400' },
            { label: 'Revenue 24h',    value: `$${totalRev24h.toFixed(2)}`, icon: DollarSign, color: 'text-violet-400' },
            { label: 'At Risk',        value: atRisk,      icon: ShieldAlert,  color: 'text-red-400'     },
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

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      {!scopeError && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            data-testid="input-client-search"
            type="text"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by name or account ID…"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border/60 bg-muted/30 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      )}

      {/* ── Client table ───────────────────────────────────────────────────── */}
      {!scopeError && (
        <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {['Client', 'Account ID', 'KAM', 'Health', 'Live Calls', 'Revenue 24h', 'Status', 'Trend'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={8} className="text-center py-16 text-muted-foreground">
                      <Activity className="w-5 h-5 animate-pulse mx-auto mb-2" />
                      Loading portfolio clients…
                    </td>
                  </tr>
                )}
                {!isLoading && clients.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-16 text-muted-foreground text-sm">
                      {search ? `No clients match "${search}"` : 'No clients in scope.'}
                    </td>
                  </tr>
                )}
                {!isLoading && clients.map((c, i) => {
                  const stats = statsMap.get(c.accountId);
                  return (
                    <tr
                      key={c.accountId}
                      data-testid={`row-client-${c.accountId}`}
                      className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/5'}`}
                    >
                      {/* Client name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                          <span className="font-medium text-foreground">{c.clientName}</span>
                        </div>
                      </td>

                      {/* Account ID */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-muted-foreground bg-muted/40 px-2 py-0.5 rounded">
                          {c.accountId}
                        </span>
                      </td>

                      {/* KAM */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">{c.kamName}</span>
                      </td>

                      {/* Health */}
                      <td className="px-4 py-3">
                        <HealthBar score={stats?.healthScore ?? null} />
                      </td>

                      {/* Live Calls */}
                      <td className="px-4 py-3">
                        {stats ? (
                          <div className="flex items-center gap-1.5">
                            {(stats.liveCallCount ?? 0) > 0
                              ? <Wifi className="w-3 h-3 text-emerald-400" />
                              : <WifiOff className="w-3 h-3 text-muted-foreground/40" />
                            }
                            <span className={`tabular-nums text-xs font-semibold ${(stats.liveCallCount ?? 0) > 0 ? 'text-emerald-400' : 'text-muted-foreground/50'}`}>
                              {stats.liveCallCount ?? 0}
                            </span>
                          </div>
                        ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                      </td>

                      {/* Revenue 24h */}
                      <td className="px-4 py-3">
                        {stats ? (
                          <span className="tabular-nums text-xs font-medium text-violet-400">
                            ${(stats.revenue24h ?? 0).toFixed(2)}
                          </span>
                        ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StateBadge state={stats?.state ?? 'unknown'} />
                      </td>

                      {/* Trend */}
                      <td className="px-4 py-3">
                        <TrendIcon dir={stats?.trendDirection ?? 'stable'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40 bg-muted/10">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages} · {total} clients
              </span>
              <div className="flex items-center gap-1">
                <button
                  data-testid="button-prev-page"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="p-1.5 rounded-md hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  data-testid="button-next-page"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="p-1.5 rounded-md hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── No Traffic note ─────────────────────────────────────────────────── */}
      {!scopeError && noTraffic > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-400/80">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {noTraffic} client{noTraffic > 1 ? 's' : ''} with no traffic in the last 24 hours.
          <Link href="/kam-dashboard" className="underline underline-offset-2 hover:text-amber-400 transition-colors">
            View in KAM Dashboard →
          </Link>
        </div>
      )}
    </div>
  );
}
