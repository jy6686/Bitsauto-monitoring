/**
 * commercial-workspace-context.tsx
 *
 * Single source of truth for the Commercial Workspace.
 * Scope is resolved ONCE here; every section consumes it via useCommercialWorkspace().
 *
 * Data loaded here:
 *   /api/commercial/scope    — accountIds, orgRole, isAdmin, kamIds, scopeError
 *   /api/kam/portfolio       — per-account health, live call counts, revenue
 *   /api/commercial/dashboard/kpis — aggregate KPIs
 *   /api/commercial/live-calls    — hierarchy-filtered live calls (15 s refresh)
 *
 * Sections that need section-specific data (e.g. balance, rate jobs, live-traffic)
 * still fetch their own data — but they never re-resolve scope themselves.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

// ── Canonical types ───────────────────────────────────────────────────────────

export interface CommercialScope {
  accountIds: string[];
  kamIds:     number[];
  orgRole:    string | null;
  isAdmin:    boolean;
  scopeError: string | null;
}

export interface PortfolioAccount {
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

export interface DashboardKpis {
  accountCount:     number;
  pendingFirstRate: number;
  pendingApproval:  number;
  scopeError:       string | null;
}

export interface LiveCall {
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

export interface LiveCallsResp {
  calls:         LiveCall[];
  total:         number;
  totalOnSwitch: number;
  scopeError:    'no_kam_link' | 'no_accounts' | null;
  orgRole:       string | null;
  lastUpdated:   number | null;
}

// ── Context shape ─────────────────────────────────────────────────────────────

export interface CommercialWorkspaceCtx {
  /** Resolved scope — undefined while loading */
  scope:        CommercialScope | undefined;
  /** All portfolio accounts (from /api/kam/portfolio) */
  portfolio:    PortfolioAccount[];
  /** Dashboard KPIs aggregate */
  kpis:         DashboardKpis | undefined;
  /** Live calls for this portfolio */
  liveData:     LiveCallsResp | undefined;
  /** True while the initial scope query is loading */
  isLoading:    boolean;

  // Derived badge counts — pre-computed so sidebar doesn't recalculate
  liveCallCount: number;
  atRiskCount:   number;
  clientCount:   number;

  // Convenience: indexed by accountId for O(1) section lookups
  portfolioMap: Map<string, PortfolioAccount>;
}

// ── Context + hook ────────────────────────────────────────────────────────────

const CommercialWorkspaceContext = createContext<CommercialWorkspaceCtx | null>(null);

export function useCommercialWorkspace(): CommercialWorkspaceCtx {
  const ctx = useContext(CommercialWorkspaceContext);
  if (!ctx) throw new Error('useCommercialWorkspace must be used within CommercialWorkspaceProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function CommercialWorkspaceProvider({ children }: { children: ReactNode }) {
  const scopeQ = useQuery<CommercialScope>({
    queryKey:  ['/api/commercial/scope'],
    staleTime: 5 * 60_000,
  });

  const portfolioQ = useQuery<{ portfolio: PortfolioAccount[] }>({
    queryKey:       ['/api/kam/portfolio'],
    staleTime:      20_000,
    refetchInterval: 30_000,
  });

  const kpisQ = useQuery<DashboardKpis>({
    queryKey:  ['/api/commercial/dashboard/kpis'],
    staleTime: 30_000,
  });

  const liveQ = useQuery<LiveCallsResp>({
    queryKey:       ['/api/commercial/live-calls'],
    staleTime:      10_000,
    refetchInterval: 15_000,
  });

  const scope     = scopeQ.data;
  const portfolio = portfolioQ.data?.portfolio ?? [];
  const kpis      = kpisQ.data;
  const liveData  = liveQ.data;

  const portfolioMap = useMemo(
    () => new Map(portfolio.map(a => [a.accountId, a])),
    [portfolio],
  );

  const liveCallCount = liveData?.total  ?? 0;
  const atRiskCount   = portfolio.filter(a => ['at_risk', 'degraded'].includes(a.state)).length;
  const clientCount   = kpis?.accountCount ?? portfolio.length;

  const value: CommercialWorkspaceCtx = {
    scope, portfolio, kpis, liveData, portfolioMap,
    isLoading:  scopeQ.isLoading,
    liveCallCount, atRiskCount, clientCount,
  };

  return (
    <CommercialWorkspaceContext.Provider value={value}>
      {children}
    </CommercialWorkspaceContext.Provider>
  );
}
