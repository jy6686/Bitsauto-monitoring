/**
 * commercial-workspace.tsx — Commercial Portal Single-Page Workspace
 *
 * Architecture:
 *   - Scope resolved ONCE at workspace level via /api/commercial/scope
 *   - Left sidebar switches sections (no page navigation)
 *   - Every section is hierarchy-scoped — account data filtered server-side
 *   - KPI strip always visible at top
 *
 * Sections: Dashboard · Clients · Live Calls · Live Traffic · Balance · Products · Reports
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  LayoutDashboard, Users, Phone, Activity, Wallet, Layers,
  BarChart2, Search, AlertTriangle, Info,
  Wifi, WifiOff, Clock, Building2, TrendingUp,
  TrendingDown, Minus, RefreshCw, ShieldAlert, DollarSign,
  ExternalLink, FileText, ArrowRight, Lock,
  type LucideProps,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type SectionId = 'dashboard' | 'clients' | 'live-calls' | 'live-traffic' | 'balance' | 'products' | 'reports';

interface CommercialScope {
  accountIds: string[];
  kamIds:     number[];
  orgRole:    string | null;
  isAdmin:    boolean;
  scopeError: string | null;
}

interface PortfolioAccount {
  accountId:      string;
  clientName:     string;
  kamId:          number;
  healthScore:    number | null;
  state:          string;
  liveCallCount:  number;
  calls24h:       number;
  revenue24h:     number;
  trendDirection: string;
  reasons:        string[];
}

interface LiveCall {
  accountId?:   string;
  clientName?:  string;
  callStatus:   string;
  cli?:         string;
  cld?:         string;
  duration?:    number;
  vendor?:      string;
  destFull?:    string;
  destCountry?: string;
  connection?:  string;
}

interface LiveCallsResp {
  calls:         LiveCall[];
  total:         number;
  totalOnSwitch: number;
  scopeError:    string | null;
  orgRole:       string | null;
  lastUpdated:   number | null;
}

interface DashboardKpis {
  accountCount:    number;
  pendingFirstRate: number;
  pendingApproval:  number;
  scopeError:      string | null;
}

interface BalanceAccount {
  i_account:       number;
  name:            string;
  balance:         number;
  credit_limit?:   number;
  balance_flag?:   string;
}

interface RatePushJob {
  id:          number;
  status:      string;
  iAccount?:   number;
  clientName?: string;
  createdAt?:  string;
  completedAt?: string;
  totalRates?: number;
  pushedRates?: number;
}

// ── Shared small components ───────────────────────────────────────────────────

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
  return <Minus className="w-3 h-3 text-muted-foreground/40" />;
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

function DashboardSection({
  scope, portfolio, kpis, liveCalls,
}: {
  scope:     CommercialScope;
  portfolio: PortfolioAccount[];
  kpis:      DashboardKpis | undefined;
  liveCalls: LiveCallsResp | undefined;
}) {
  const atRisk   = portfolio.filter(a => ['at_risk', 'degraded'].includes(a.state));
  const rev24h   = portfolio.reduce((s, a) => s + (a.revenue24h ?? 0), 0);
  const totalCalls = liveCalls?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground mb-4">Portfolio Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Total Clients',   value: kpis?.accountCount ?? 0,  icon: Users,      color: 'text-sky-400'     },
            { label: 'Live Calls',      value: totalCalls,                 icon: Phone,      color: 'text-emerald-400' },
            { label: 'Revenue 24h',     value: `$${rev24h.toFixed(2)}`,   icon: DollarSign, color: 'text-violet-400'  },
            { label: 'At Risk',         value: atRisk.length,             icon: ShieldAlert, color: 'text-red-400'    },
            { label: 'Pending Rates',   value: kpis?.pendingFirstRate ?? 0, icon: FileText, color: 'text-amber-400'   },
            { label: 'Pending Approval',value: kpis?.pendingApproval ?? 0,  icon: Clock,    color: 'text-orange-400'  },
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
            {atRisk.slice(0, 5).map(a => (
              <div key={a.accountId} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-red-500/20 bg-red-500/5">
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-red-400/60 shrink-0" />
                  <span className="text-sm font-medium">{a.clientName}</span>
                  <span className="font-mono text-xs text-muted-foreground/50">#{a.accountId}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StateBadge state={a.state} />
                  {a.reasons[0] && <span className="text-xs text-muted-foreground/60 max-w-[200px] truncate">{a.reasons[0]}</span>}
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

function ClientsSection({ scope, portfolio }: { scope: CommercialScope; portfolio: PortfolioAccount[] }) {
  const [search, setSearch] = useState('');
  const [page,   setPage  ] = useState(1);
  const [apiSearch, setApiSearch] = useState('');

  const statsMap = useMemo(() => {
    const m = new Map<string, PortfolioAccount>();
    portfolio.forEach(a => m.set(a.accountId, a));
    return m;
  }, [portfolio]);

  const clientsQ = useQuery<{ clients: any[]; total: number; scopeError: string | null }>({
    queryKey: ['/api/commercial/clients', apiSearch, page],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (apiSearch) p.set('search', apiSearch);
      p.set('page', String(page));
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
        <h3 className="text-base font-semibold text-foreground">Portfolio Clients</h3>
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
              <tr><td colSpan={8} className="text-center py-12 text-muted-foreground text-xs"><Activity className="w-4 h-4 animate-pulse mx-auto mb-1" />Loading…</td></tr>
            )}
            {!clientsQ.isLoading && clients.map((c, i) => {
              const stats = statsMap.get(c.accountId);
              return (
                <tr key={c.accountId} data-testid={`row-ws-client-${c.accountId}`} className={`border-b border-border/25 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
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
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded hover:bg-muted/40 disabled:opacity-40">←</button>
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
  const [search, setSearch] = useState('');
  const [tick,   setTick  ] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => setTick(t => t + 1), 15_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const q = useQuery<LiveCallsResp>({
    queryKey: ['/api/commercial/live-calls', tick],
    staleTime: 10_000,
  });

  const allCalls = q.data?.calls ?? [];
  const searched = useMemo(() => {
    if (!search.trim()) return allCalls;
    const lq = search.toLowerCase();
    return allCalls.filter(c =>
      (c.clientName ?? '').toLowerCase().includes(lq) ||
      (c.cli ?? '').includes(lq) ||
      (c.cld ?? '').includes(lq) ||
      (c.destCountry ?? '').toLowerCase().includes(lq)
    );
  }, [allCalls, search]);

  const connected = allCalls.filter(c => c.callStatus === 'connected').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">Live Calls</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {q.data?.total ?? 0} portfolio calls · {q.data?.totalOnSwitch ?? 0} total on switch · auto-refresh 15 s
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {q.isFetching && <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />}
          <span className="text-emerald-400 font-semibold">{connected} connected</span>
        </div>
      </div>
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          data-testid="input-ws-live-search"
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter by client, CLI, CLD…"
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
            {q.isLoading && (
              <tr><td colSpan={7} className="text-center py-12 text-xs text-muted-foreground"><Activity className="w-4 h-4 animate-pulse mx-auto mb-1" />Loading live calls…</td></tr>
            )}
            {!q.isLoading && searched.length === 0 && (
              <tr><td colSpan={7} className="text-center py-10 text-xs text-muted-foreground">
                {allCalls.length === 0 ? 'No active calls in your portfolio.' : `No calls match "${search}".`}
              </td></tr>
            )}
            {!q.isLoading && searched.map((c, i) => (
              <tr key={`${c.cli}-${c.cld}-${i}`} data-testid={`row-ws-call-${i}`} className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                <td className="px-3 py-2 text-xs font-medium">{c.clientName ?? `Acct.${c.accountId ?? '—'}`}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{c.cli ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{c.cld ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[120px]">{c.destFull ?? c.destCountry ?? '—'}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{fmtDuration(c.duration)}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${c.callStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}`}>
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

// ── Section: Live Traffic (BitsEye2 portfolio-first) ─────────────────────────

function LiveTrafficSection({ scope, portfolio }: { scope: CommercialScope; portfolio: PortfolioAccount[] }) {
  const [search, setSearch] = useState('');

  const sorted = useMemo(() => {
    const filtered = search
      ? portfolio.filter(a => a.clientName.toLowerCase().includes(search.toLowerCase()))
      : portfolio;
    return [...filtered].sort((a, b) => (b.liveCallCount ?? 0) - (a.liveCallCount ?? 0));
  }, [portfolio, search]);

  const countries = useMemo(() => {
    // Aggregate country-level call counts (not available at account level — placeholder)
    return [];
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Live Traffic</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Portfolio-first view — assigned accounts sorted by activity</p>
        </div>
        <Link
          href="/bitseye2"
          className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors border border-sky-500/30 rounded-lg px-2.5 py-1.5 hover:bg-sky-500/10"
        >
          <ExternalLink className="w-3 h-3" /> Full BitsEye2
        </Link>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter accounts…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border/60 bg-muted/30 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map(a => (
          <div
            key={a.accountId}
            data-testid={`card-traffic-${a.accountId}`}
            className="rounded-xl border border-border/50 bg-card/60 p-3 space-y-2 hover:bg-card/80 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{a.clientName}</div>
                <div className="font-mono text-[10px] text-muted-foreground/60">#{a.accountId}</div>
              </div>
              <StateBadge state={a.state} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {(a.liveCallCount ?? 0) > 0
                  ? <Wifi className="w-3 h-3 text-emerald-400" />
                  : <WifiOff className="w-3 h-3 text-muted-foreground/30" />
                }
                <span className={`text-sm font-bold tabular-nums ${(a.liveCallCount ?? 0) > 0 ? 'text-emerald-400' : 'text-muted-foreground/40'}`}>
                  {a.liveCallCount ?? 0}
                </span>
                <span className="text-[10px] text-muted-foreground">live</span>
              </div>
              <div className="text-right">
                <div className="text-xs text-violet-400 tabular-nums">${(a.revenue24h ?? 0).toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">24h rev</div>
              </div>
            </div>
            <HealthBar score={a.healthScore} />
          </div>
        ))}
        {sorted.length === 0 && (
          <div className="col-span-3 py-10 text-center text-xs text-muted-foreground">No accounts match your filter.</div>
        )}
      </div>
    </div>
  );
}

// ── Section: Balance ──────────────────────────────────────────────────────────

function BalanceSection({ scope }: { scope: CommercialScope }) {
  const q = useQuery<{ accounts: BalanceAccount[] }>({
    queryKey: ['/api/sippy/balance-monitor'],
    staleTime: 60_000,
  });

  const scopeSet = useMemo(() => new Set(scope.accountIds.map(String)), [scope.accountIds]);

  const accounts = useMemo(() => {
    if (!q.data?.accounts) return [];
    const all = q.data.accounts;
    return scope.isAdmin
      ? all
      : all.filter(a => scopeSet.has(String(a.i_account)));
  }, [q.data, scopeSet, scope.isAdmin]);

  const totalBalance = accounts.reduce((s, a) => s + (a.balance ?? 0), 0);
  const lowBalance   = accounts.filter(a => a.balance_flag === 'low' || (a.credit_limit && a.balance < (a.credit_limit * 0.1)));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Balance</h3>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Read-only · {accounts.length} accounts in scope
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-emerald-400">${totalBalance.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">Total portfolio balance</div>
        </div>
      </div>

      {lowBalance.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {lowBalance.length} account{lowBalance.length > 1 ? 's' : ''} with low balance.
        </div>
      )}

      <div className="rounded-xl border border-border/50 bg-card/40 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/20">
              {['Account', 'Acct ID', 'Balance', 'Credit Limit', 'Status'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr><td colSpan={5} className="text-center py-10 text-xs text-muted-foreground"><Activity className="w-4 h-4 animate-pulse mx-auto mb-1" />Loading…</td></tr>
            )}
            {!q.isLoading && accounts.map((a, i) => {
              const isLow = a.balance_flag === 'low' || (a.credit_limit && a.balance < (a.credit_limit * 0.1));
              return (
                <tr key={a.i_account} className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                  <td className="px-3 py-2 text-xs font-medium">{a.name}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{a.i_account}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold tabular-nums ${isLow ? 'text-red-400' : 'text-emerald-400'}`}>
                      ${(a.balance ?? 0).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                    {a.credit_limit != null ? `$${a.credit_limit.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {isLow
                      ? <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">Low</span>
                      : <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">OK</span>
                    }
                  </td>
                </tr>
              );
            })}
            {!q.isLoading && accounts.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-xs text-muted-foreground">No balance data available.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Section: Products ─────────────────────────────────────────────────────────

function ProductsSection() {
  const jobsQ = useQuery<{ jobs: RatePushJob[] }>({
    queryKey: ['/api/rate-manager/jobs'],
    staleTime: 30_000,
  });

  const recentJobs = (jobsQ.data?.jobs ?? []).slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Products · Rate Manager</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Rate analysis, send rates, and push history</p>
        </div>
        <Link
          href="/rate-manager"
          className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors border border-sky-500/30 rounded-lg px-2.5 py-1.5 hover:bg-sky-500/10"
        >
          Open Rate Manager <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Rate Analysis',  desc: 'Analyse rates against destination catalogue', href: '/rate-manager',    icon: BarChart2  },
          { label: 'Send Rate',      desc: 'Push rates to Sippy tariffs',                  href: '/rate-manager',    icon: TrendingUp },
          { label: 'Push History',   desc: 'View rate push job history and status',        href: '/rate-manager',    icon: Clock      },
        ].map(item => (
          <Link key={item.label} href={item.href}>
            <div className="rounded-xl border border-border/50 bg-card/60 p-4 hover:bg-card/80 hover:border-sky-500/30 transition-colors cursor-pointer group">
              <item.icon className="w-4 h-4 text-sky-400 mb-2" />
              <div className="text-sm font-medium group-hover:text-sky-400 transition-colors">{item.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{item.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {recentJobs.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent Rate Push Jobs</h4>
          <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {['Job ID', 'Client', 'Status', 'Rates', 'Created'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((j, i) => (
                  <tr key={j.id} className={`border-b border-border/25 hover:bg-muted/20 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">#{j.id}</td>
                    <td className="px-3 py-2 text-xs">{j.clientName ?? `Acct.${j.iAccount ?? '—'}`}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                        j.status === 'completed' ? 'text-emerald-400' :
                        j.status === 'failed'    ? 'text-red-400' :
                        'text-amber-400'
                      }`}>{j.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                      {j.pushedRates ?? 0}/{j.totalRates ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {j.createdAt ? new Date(j.createdAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section: Reports ──────────────────────────────────────────────────────────

function ReportsSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">Reports</h3>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          <Lock className="w-3 h-3" /> Read-only · Revenue · Forecast · Profit / Loss
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            label: 'Revenue Report',
            desc:  'Portfolio revenue breakdown by account and destination. Filter, search, export.',
            href:  '/revenue-heatmap',
            icon:  DollarSign,
            color: 'text-violet-400',
          },
          {
            label: 'Traffic Forecast',
            desc:  'Forecast portfolio traffic and revenue trends. Read-only planning view.',
            href:  '/traffic-forecast',
            icon:  TrendingUp,
            color: 'text-sky-400',
          },
          {
            label: 'Profit / Loss',
            desc:  'P&L analysis across portfolio accounts. Margin, cost, and revenue breakdown.',
            href:  '/analytics',
            icon:  BarChart2,
            color: 'text-emerald-400',
          },
        ].map(r => (
          <Link key={r.label} href={r.href}>
            <div className="rounded-xl border border-border/50 bg-card/60 p-4 hover:bg-card/80 transition-colors cursor-pointer group">
              <r.icon className={`w-4 h-4 mb-2 ${r.color}`} />
              <div className="text-sm font-medium group-hover:text-foreground transition-colors">{r.label}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.desc}</div>
              <div className="flex items-center gap-1 mt-3 text-xs text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Open report <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Main workspace page ───────────────────────────────────────────────────────

type IconComponent = (props: LucideProps) => JSX.Element;

const SECTIONS: { id: SectionId; label: string; icon: IconComponent }[] = [
  { id: 'dashboard',    label: 'Dashboard',     icon: LayoutDashboard },
  { id: 'clients',      label: 'Clients',        icon: Users           },
  { id: 'live-calls',   label: 'Live Calls',     icon: Phone           },
  { id: 'live-traffic', label: 'Live Traffic',   icon: Activity        },
  { id: 'balance',      label: 'Balance',        icon: Wallet          },
  { id: 'products',     label: 'Products',       icon: Layers          },
  { id: 'reports',      label: 'Reports',        icon: BarChart2       },
];

export default function CommercialWorkspacePage() {
  const [active, setActive] = useState<SectionId>('dashboard');

  const scopeQ     = useQuery<CommercialScope>({ queryKey: ['/api/commercial/scope'], staleTime: 5*60_000 });
  const portfolioQ = useQuery<{ portfolio: PortfolioAccount[] }>({ queryKey: ['/api/kam/portfolio'], staleTime: 20_000, refetchInterval: 30_000 });
  const kpisQ      = useQuery<DashboardKpis>({ queryKey: ['/api/commercial/dashboard/kpis'], staleTime: 30_000 });
  const liveQ      = useQuery<LiveCallsResp>({ queryKey: ['/api/commercial/live-calls'], staleTime: 15_000, refetchInterval: 15_000 });

  const scope     = scopeQ.data;
  const portfolio = portfolioQ.data?.portfolio ?? [];
  const kpis      = kpisQ.data;
  const liveCalls = liveQ.data;

  // Live badge counts for sidebar
  const liveCount   = liveCalls?.total  ?? 0;
  const clientCount = kpis?.accountCount ?? 0;
  const atRiskCount = portfolio.filter(a => ['at_risk', 'degraded'].includes(a.state)).length;

  const badges: Partial<Record<SectionId, number>> = {
    clients:    clientCount,
    'live-calls': liveCount,
    dashboard:  atRiskCount > 0 ? atRiskCount : 0,
  };

  if (scope?.scopeError) {
    return (
      <div className="flex items-center justify-center h-64">
        <ScopeAlert error={scope.scopeError} />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 rounded-xl border border-border/50 overflow-hidden bg-card/20">

      {/* ── Left sidebar ───────────────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-border/50 bg-card/60 flex flex-col">

        {/* Scope header */}
        <div className="px-4 py-3 border-b border-border/40">
          <div className="text-xs font-semibold text-foreground">Commercial Portal</div>
          {scope && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {scope.isAdmin ? 'All Accounts' : (scope.orgRole ?? 'KAM')} ·{' '}
              <span className="font-semibold text-foreground">{scope.accountIds.length}</span> accts
            </div>
          )}
        </div>

        {/* Nav items */}
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
                {badge ? (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    s.id === 'dashboard' && atRiskCount > 0
                      ? 'bg-red-500/20 text-red-400'
                      : s.id === 'live-calls'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-muted/60 text-muted-foreground'
                  }`}>{badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Scope info footer */}
        <div className="px-4 py-3 border-t border-border/40">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Info className="w-3 h-3 shrink-0" />
            Hierarchy-scoped · read-only where indicated
          </div>
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6">
        {active === 'dashboard'    && <DashboardSection scope={scope ?? { accountIds: [], kamIds: [], orgRole: null, isAdmin: false, scopeError: null }} portfolio={portfolio} kpis={kpis} liveCalls={liveCalls} />}
        {active === 'clients'      && scope && <ClientsSection scope={scope} portfolio={portfolio} />}
        {active === 'live-calls'   && <LiveCallsSection />}
        {active === 'live-traffic' && scope && <LiveTrafficSection scope={scope} portfolio={portfolio} />}
        {active === 'balance'      && scope && <BalanceSection scope={scope} />}
        {active === 'products'     && <ProductsSection />}
        {active === 'reports'      && <ReportsSection />}
      </main>
    </div>
  );
}
