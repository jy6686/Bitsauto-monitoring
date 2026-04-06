import { useCalls } from "@/hooks/use-calls";
import { MosBadge } from "@/components/mos-badge";
import { Link } from "wouter";
import { Phone, Clock, Search, BarChart3, List, RefreshCw, CheckCircle2, ArrowRightLeft, Globe } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { lookupCountry } from "@/lib/country-lookup";
import { useQuery } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveCall {
  id: string;
  caller: string;
  callee: string;
  gateway: string;
  clientName?: string;
  duration: number;
  callStatus: 'connected' | 'routing';
}

interface SummaryRow {
  client: string;
  country: string;
  flag: string;
  connected: number;
  routing: number;
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSummary(calls: LiveCall[]): SummaryRow[] {
  const map = new Map<string, SummaryRow>();
  for (const c of calls) {
    const client = c.clientName || c.caller || 'Unknown';
    const dest = lookupCountry(c.callee);
    const country = dest?.name ?? 'Unknown';
    const flag = dest?.flag ?? '🌐';
    const key = `${client}||${country}`;
    if (!map.has(key)) {
      map.set(key, { client, country, flag, connected: 0, routing: 0, total: 0 });
    }
    const row = map.get(key)!;
    if (c.callStatus === 'connected') row.connected++;
    else row.routing++;
    row.total++;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CallsListPage() {
  const { data: calls, isLoading } = useCalls(200);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<'details' | 'summary'>('summary');

  // Portal live calls (for summary view when connected)
  const { data: portalSession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
  });
  const { data: portalLiveCalls, isLoading: portalLoading, refetch: refetchPortal } = useQuery<{ calls: LiveCall[]; error?: string }>({
    queryKey: ['/api/portal/live-calls'],
    refetchInterval: 15000,
    enabled: !!portalSession?.active,
  });

  // Build summary data
  const liveCalls: LiveCall[] = portalSession?.active
    ? (portalLiveCalls?.calls ?? [])
    : (calls ?? []).filter((c: any) => c.status === 'active').map((c: any) => ({
        id: String(c.id),
        caller: c.caller,
        callee: c.callee,
        gateway: '',
        duration: 0,
        callStatus: 'connected' as const,
      }));

  const summaryRows = buildSummary(liveCalls);

  // Summary totals
  const totalConnected = summaryRows.reduce((s, r) => s + r.connected, 0);
  const totalRouting = summaryRows.reduce((s, r) => s + r.routing, 0);
  const totalCalls = summaryRows.reduce((s, r) => s + r.total, 0);

  const filteredCalls = calls?.filter((call: any) =>
    call.caller.includes(search) || call.callee.includes(search)
  );

  const isLivePortal = !!portalSession?.active;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Active Calls</h2>
          <p className="text-muted-foreground mt-1">
            {isLivePortal
              ? `Live data from VOS3000 · ${totalCalls} calls active`
              : 'Real-time monitoring of all active sessions.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isLivePortal && (
            <button
              onClick={() => refetchPortal()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-card border border-border hover:bg-muted/40 transition-colors"
              data-testid="button-refresh-live-calls"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          )}
          {tab === 'details' && (
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search number or country..."
                className="w-full bg-background border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-calls"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-xl border border-border/50 w-fit">
        <button
          onClick={() => setTab('summary')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'summary'
              ? 'bg-background text-foreground shadow-sm border border-border/50'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          data-testid="tab-call-summary"
        >
          <BarChart3 className="w-4 h-4" />
          Active Call Summary
        </button>
        <button
          onClick={() => setTab('details')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'details'
              ? 'bg-background text-foreground shadow-sm border border-border/50'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          data-testid="tab-call-details"
        >
          <List className="w-4 h-4" />
          Active Call Details
        </button>
      </div>

      {/* ── SUMMARY TAB ──────────────────────────────────────────────────── */}
      {tab === 'summary' && (
        <div className="space-y-4">
          {/* Totals strip */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-400" data-testid="stat-total-connected">{totalConnected}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Connected Calls</p>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <ArrowRightLeft className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-400" data-testid="stat-total-routing">{totalRouting}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Routing Calls</p>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                <Phone className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-violet-400" data-testid="stat-total-calls">{totalCalls}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total Active Calls</p>
              </div>
            </div>
          </div>

          {/* Summary table */}
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            {(isLivePortal ? portalLoading : isLoading) ? (
              <div className="p-12 text-center text-muted-foreground">Loading active calls...</div>
            ) : summaryRows.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-14 h-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-3">
                  <Phone className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <p className="text-muted-foreground">
                  {isLivePortal ? 'No active calls on the switch right now.' : 'No active calls. Connect to VOS3000 for live data.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/40 text-muted-foreground border-b border-border/50">
                    <tr>
                      <th className="px-6 py-3.5 font-medium">Client</th>
                      <th className="px-6 py-3.5 font-medium">Destination Country</th>
                      <th className="px-6 py-3.5 font-medium text-center">
                        <span className="inline-flex items-center gap-1.5 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Connected
                        </span>
                      </th>
                      <th className="px-6 py-3.5 font-medium text-center">
                        <span className="inline-flex items-center gap-1.5 text-amber-400">
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          Routing
                        </span>
                      </th>
                      <th className="px-6 py-3.5 font-medium text-center text-violet-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {summaryRows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors" data-testid={`row-summary-${i}`}>
                        <td className="px-6 py-3.5">
                          <span className="font-medium">{row.client}</span>
                        </td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
                            <span>{row.flag} {row.country}</span>
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          {row.connected > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[2rem] px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20" data-testid={`cell-connected-${i}`}>
                              {row.connected}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">0</span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          {row.routing > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[2rem] px-2.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/20" data-testid={`cell-routing-${i}`}>
                              {row.routing}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">0</span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          <span className="font-bold text-violet-400" data-testid={`cell-total-${i}`}>{row.total}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/20 border-t border-border/50">
                    <tr>
                      <td className="px-6 py-3 font-semibold text-foreground" colSpan={2}>Total</td>
                      <td className="px-6 py-3 text-center">
                        <span className="font-bold text-emerald-400">{totalConnected}</span>
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span className="font-bold text-amber-400">{totalRouting}</span>
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span className="font-bold text-violet-400">{totalCalls}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {!isLivePortal && (
            <p className="text-xs text-muted-foreground text-center">
              Connect to VOS3000 in Settings to see live Connected / Routing breakdown per client.
            </p>
          )}
        </div>
      )}

      {/* ── DETAILS TAB ──────────────────────────────────────────────────── */}
      {tab === 'details' && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading calls...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/40 text-muted-foreground border-b border-border/50">
                  <tr>
                    <th className="px-6 py-4 font-medium">Caller</th>
                    <th className="px-6 py-4 font-medium">Destination</th>
                    <th className="px-6 py-4 font-medium">Started</th>
                    <th className="px-6 py-4 font-medium">Quality (MOS)</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredCalls?.map((call: any) => {
                    const callerCountry = lookupCountry(call.caller);
                    const calleeCountry = lookupCountry(call.callee);
                    return (
                      <tr key={call.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-call-${call.id}`}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                              <Phone className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="font-mono text-sm">{call.caller}</span>
                              {callerCountry ? (
                                <p className="text-xs text-muted-foreground mt-0.5">{callerCountry.flag} {callerCountry.name}</p>
                              ) : (
                                <p className="text-xs text-muted-foreground/50 mt-0.5">Local / Unknown</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-sm">{call.callee}</span>
                          {calleeCountry ? (
                            <p className="text-xs text-muted-foreground mt-0.5">{calleeCountry.flag} {calleeCountry.name}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground/50 mt-0.5">Local / Unknown</p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3" />
                            {call.startTime ? format(new Date(call.startTime), 'HH:mm:ss') : '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <MosBadge value={call.latestMetric?.mos || 0} />
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            call.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                              : call.status === 'failed'
                              ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                              : 'bg-muted text-muted-foreground border border-border/50'
                          }`}>
                            {call.status === 'active' && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            )}
                            {call.status.charAt(0).toUpperCase() + call.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/calls/${call.id}`}
                            className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium bg-secondary hover:bg-secondary/80 transition-colors"
                            data-testid={`link-inspect-${call.id}`}
                          >
                            Inspect
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCalls?.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                        No calls found matching your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
