import {
  Phone, Clock, Search, BarChart3, List, RefreshCw, CheckCircle2,
  ArrowRightLeft, Globe, Server, Loader2, AlertCircle,
  ChevronDown, ChevronRight, PhoneOff, ArrowUpRight, ArrowDownLeft, Network,
} from "lucide-react";
import { useState, useRef, Fragment } from "react";
import { lookupCountry } from "@/lib/country-lookup";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

// CC_STATE color + label mappings (Sippy docs 107462)
const CC_STATE_STYLE: Record<string, { label: string; dot: string; badge: string }> = {
  Connected:    { label: 'Connected',    dot: 'bg-emerald-400 animate-pulse', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  ARComplete:   { label: 'Connecting…',  dot: 'bg-blue-400 animate-pulse',    badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  WaitRoute:    { label: 'Routing…',     dot: 'bg-amber-400 animate-pulse',   badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  WaitAuth:     { label: 'Auth…',        dot: 'bg-yellow-400',                badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  Idle:         { label: 'Idle',         dot: 'bg-muted-foreground',          badge: 'bg-muted/30 text-muted-foreground border-border/50' },
  Disconnecting:{ label: 'Ending…',      dot: 'bg-rose-400',                  badge: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
  Dead:         { label: 'Dead',         dot: 'bg-zinc-600',                  badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
};

interface LiveCall {
  id: string;
  caller: string;        // CLI (calling number)
  callee: string;        // CLD (destination number)
  gateway: string;
  clientName?: string;   // Account / customer name
  accountId?: string;    // Sippy i_account (determines trunk class: 1xx=First, 2xx=Business, 7xx=Charlie)
  duration: number;
  callStatus: 'connected' | 'routing';
  ccState?: string;      // Full Sippy CC_STATE (Connected | ARComplete | WaitRoute | WaitAuth | Idle | Disconnecting | Dead)
  // Sippy-specific fields
  callId?: string;       // SIP Call-ID (CALL_ID)
  iCustomer?: string;    // Customer ID (I_CUSTOMER)
  vendor?: string;
  connection?: string;
  direction?: string;    // DIRECTION: vendor | onnet_in | onnet_out | originate
  mediaIpCaller?: string;
  mediaIpCallee?: string;
  delay?: number;        // DELAY in seconds (PDD)
  setupTime?: string;    // SETUP_TIME timestamp
  codec?: string;
  state?: string;
}

// Direction display config
const DIRECTION_STYLE: Record<string, { label: string; color: string; icon: 'in' | 'out' | 'net' }> = {
  vendor:    { label: 'Vendor',   color: 'text-orange-400 bg-orange-500/10 border-orange-500/20',  icon: 'out' },
  onnet_in:  { label: 'Inbound',  color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: 'in' },
  onnet_out: { label: 'On-Net',   color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',        icon: 'out' },
  originate: { label: 'Origin',   color: 'text-violet-400 bg-violet-500/10 border-violet-500/20',  icon: 'out' },
};

interface SummaryRow {
  client: string;
  country: string;
  flag: string;
  connected: number;
  routing: number;
  total: number;
}

interface SwitchRecord {
  id: number;
  name: string;
  type: string;
  portalUrl: string | null;
  enabled: boolean;
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

// ─── Switch Panel (per-switch live call view) ─────────────────────────────────

function SwitchPanel({
  switchId,
  switchType,
  switchName,
}: {
  switchId: number | 'primary';
  switchType: string;
  switchName: string;
}) {
  const [callViewTab, setCallViewTab] = useState<'summary' | 'details'>('summary');
  const [search, setSearch] = useState('');
  const [filterCli, setFilterCli] = useState('');
  const [filterCld, setFilterCld] = useState('');
  const [filterState, setFilterState] = useState('all');
  const [filterVendor, setFilterVendor] = useState('all');
  const [filterConnection, setFilterConnection] = useState('all');
  const [filterDirection, setFilterDirection] = useState('all');
  const [showLatestFirst, setShowLatestFirst] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [disconnectingCallId, setDisconnectingCallId] = useState<string | null>(null);
  const qc = useQueryClient();

  const disconnectCallMutation = useMutation({
    mutationFn: (callId: string) => apiRequest('POST', `/api/sippy/calls/${encodeURIComponent(callId)}/disconnect`, {}),
    onMutate: (callId) => setDisconnectingCallId(callId),
    onSettled: () => {
      setDisconnectingCallId(null);
      qc.invalidateQueries({ queryKey: ['/api/sippy/live-calls'] });
    },
  });

  const isPrimary = switchId === 'primary';

  // Primary Sippy: use /api/sippy/session + /api/sippy/live-calls
  const { data: primarySippySession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
    enabled: isPrimary,
  });
  const { data: primarySippyLiveCalls, isLoading: sippyLoading, refetch: refetchSippy } = useQuery<{ calls: LiveCall[] }>({
    queryKey: ['/api/sippy/live-calls'],
    refetchInterval: 15000,
    enabled: isPrimary && !!primarySippySession?.active,
  });

  // Secondary switch: use per-switch endpoints
  const { data: switchLiveCalls, isLoading: switchLoading, refetch: refetchSwitch } = useQuery<{ calls: LiveCall[]; error?: string }>({
    queryKey: ['/api/switches', switchId, 'live-calls'],
    refetchInterval: 15000,
    enabled: !isPrimary,
    queryFn: () => fetch(`/api/switches/${switchId}/live-calls`).then(r => r.json()),
  });

  const isActive = isPrimary ? !!primarySippySession?.active : true;
  const isLoading = isPrimary ? sippyLoading : switchLoading;

  const handleRefresh = () => isPrimary ? refetchSippy() : refetchSwitch();

  const liveCallData = isPrimary ? primarySippyLiveCalls : switchLiveCalls;

  // Build live calls list
  const liveCalls: LiveCall[] = liveCallData?.calls ?? [];

  const summaryRows = buildSummary(liveCalls);
  const totalConnected = summaryRows.reduce((s, r) => s + r.connected, 0);
  const totalRouting = summaryRows.reduce((s, r) => s + r.routing, 0);
  const totalCalls = summaryRows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-4">
      {liveCallData?.error && (
        <div className="flex items-center gap-3 p-3 bg-rose-500/5 border border-rose-500/20 rounded-xl text-sm text-rose-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {liveCallData.error}
        </div>
      )}

      {/* Summary stat cards */}
      {callViewTab === 'summary' && (
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
      )}

      {/* Sub-tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-xl border border-border/50 w-fit">
          <button
            onClick={() => setCallViewTab('summary')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              callViewTab === 'summary'
                ? 'bg-background text-foreground shadow-sm border border-border/50'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-call-summary"
          >
            <BarChart3 className="w-4 h-4" />
            Active Call Summary
          </button>
          <button
            onClick={() => setCallViewTab('details')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              callViewTab === 'details'
                ? 'bg-background text-foreground shadow-sm border border-border/50'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-call-details"
          >
            <List className="w-4 h-4" />
            Active Call Details
          </button>
        </div>

        <div className="flex items-center gap-2">
          {callViewTab === 'details' && (
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search number..."
                className="w-full bg-background border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search-calls"
              />
            </div>
          )}
          {(isActive || switchType === 'sippy') && (
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-card border border-border hover:bg-muted/40 transition-colors"
              data-testid="button-refresh-live-calls"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* ── SUMMARY TAB ──────────────────────────────────────────────────── */}
      {callViewTab === 'summary' && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading active calls...
            </div>
          ) : summaryRows.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-14 h-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-3">
                <Phone className="w-7 h-7 text-muted-foreground/40" />
              </div>
              <p className="text-muted-foreground">
                {needsLogin
                  ? 'Connect to this switch to see live calls.'
                  : switchType === 'sippy'
                  ? 'No active calls on this Sippy switch right now.'
                  : isActive
                  ? 'No active calls on the switch right now.'
                  : 'No active calls. Connect to see live data.'}
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
                        <CheckCircle2 className="w-3.5 h-3.5" />Connected
                      </span>
                    </th>
                    <th className="px-6 py-3.5 font-medium text-center">
                      <span className="inline-flex items-center gap-1.5 text-amber-400">
                        <ArrowRightLeft className="w-3.5 h-3.5" />Routing
                      </span>
                    </th>
                    <th className="px-6 py-3.5 font-medium text-center text-violet-400">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {summaryRows.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors" data-testid={`row-summary-${i}`}>
                      <td className="px-6 py-3.5"><span className="font-medium">{row.client}</span></td>
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
                        ) : <span className="text-muted-foreground/40">0</span>}
                      </td>
                      <td className="px-6 py-3.5 text-center">
                        {row.routing > 0 ? (
                          <span className="inline-flex items-center justify-center min-w-[2rem] px-2.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/20" data-testid={`cell-routing-${i}`}>
                            {row.routing}
                          </span>
                        ) : <span className="text-muted-foreground/40">0</span>}
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
                    <td className="px-6 py-3 text-center"><span className="font-bold text-emerald-400">{totalConnected}</span></td>
                    <td className="px-6 py-3 text-center"><span className="font-bold text-amber-400">{totalRouting}</span></td>
                    <td className="px-6 py-3 text-center"><span className="font-bold text-violet-400">{totalCalls}</span></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── DETAILS TAB ──────────────────────────────────────────────────── */}
      {callViewTab === 'details' && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {(() => {
            // Build unique vendor/connection/direction lists for dropdowns
            const vendors = Array.from(new Set(liveCalls.map(c => c.vendor).filter(Boolean))) as string[];
            const connections = Array.from(new Set(liveCalls.map(c => c.connection).filter(Boolean))) as string[];
            const directions = Array.from(new Set(liveCalls.map(c => c.direction).filter(Boolean))) as string[];

            // Apply filters
            let displayed = liveCalls.filter(c => {
              if (filterCli && !c.caller.toLowerCase().includes(filterCli.toLowerCase())) return false;
              if (filterCld && !c.callee.toLowerCase().includes(filterCld.toLowerCase())) return false;
              if (filterState !== 'all' && c.callStatus !== filterState) return false;
              if (filterVendor !== 'all' && c.vendor !== filterVendor) return false;
              if (filterConnection !== 'all' && c.connection !== filterConnection) return false;
              if (filterDirection !== 'all' && c.direction !== filterDirection) return false;
              if (search && !c.caller.includes(search) && !c.callee.includes(search) && !(c.clientName || '').toLowerCase().includes(search.toLowerCase())) return false;
              return true;
            });
            if (showLatestFirst) displayed = [...displayed].reverse();

            return (
              <div>
                {/* ── Filter Panel ── */}
                <div className="border-b border-border/50 bg-muted/10 px-5 py-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">CLI</label>
                      <input
                        type="text"
                        placeholder="contains..."
                        value={filterCli}
                        onChange={e => setFilterCli(e.target.value)}
                        className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all font-mono"
                        data-testid="input-filter-cli"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">CLD</label>
                      <input
                        type="text"
                        placeholder="contains..."
                        value={filterCld}
                        onChange={e => setFilterCld(e.target.value)}
                        className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all font-mono"
                        data-testid="input-filter-cld"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">State</label>
                      <select
                        value={filterState}
                        onChange={e => setFilterState(e.target.value)}
                        className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all"
                        data-testid="select-filter-state"
                      >
                        <option value="all">All</option>
                        <option value="connected">Connected</option>
                        <option value="routing">Routing</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">Vendor</label>
                      <select
                        value={filterVendor}
                        onChange={e => setFilterVendor(e.target.value)}
                        className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all"
                        data-testid="select-filter-vendor"
                      >
                        <option value="all">All</option>
                        {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">Connection</label>
                      <select
                        value={filterConnection}
                        onChange={e => setFilterConnection(e.target.value)}
                        className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all"
                        data-testid="select-filter-connection"
                      >
                        <option value="all">All</option>
                        {connections.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">Direction</label>
                      <select
                        value={filterDirection}
                        onChange={e => setFilterDirection(e.target.value)}
                        className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all"
                        data-testid="select-filter-direction"
                      >
                        <option value="all">All</option>
                        {directions.map(d => (
                          <option key={d} value={d}>{DIRECTION_STYLE[d]?.label ?? d}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end gap-2 col-span-2 md:col-span-1">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none pb-0.5">
                        <input
                          type="checkbox"
                          checked={showLatestFirst}
                          onChange={e => setShowLatestFirst(e.target.checked)}
                          className="rounded border-border"
                          data-testid="checkbox-latest-first"
                        />
                        Show Latest First
                      </label>
                    </div>
                    <div className="flex items-end col-span-2 md:col-span-1">
                      <button
                        onClick={() => { setFilterCli(''); setFilterCld(''); setFilterState('all'); setFilterVendor('all'); setFilterConnection('all'); setFilterDirection('all'); setShowLatestFirst(false); }}
                        className="px-4 py-1.5 rounded-lg bg-muted/60 border border-border text-xs hover:bg-muted transition-colors"
                        data-testid="button-filter-clear"
                      >
                        Clear Filters
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Table ── */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/40 text-muted-foreground border-b border-border/50 text-xs">
                      <tr>
                        <th className="px-3 py-3 font-medium w-8 text-center"></th>
                        <th className="px-3 py-3 font-medium w-8 text-center">#</th>
                        <th className="px-4 py-3 font-medium">Caller</th>
                        <th className="px-4 py-3 font-medium">CLI</th>
                        <th className="px-4 py-3 font-medium">CLD</th>
                        <th className="px-4 py-3 font-medium">Orig Country</th>
                        <th className="px-4 py-3 font-medium">Dest Country</th>
                        <th className="px-4 py-3 font-medium">Trunk</th>
                        <th className="px-4 py-3 font-medium">Direction</th>
                        <th className="px-4 py-3 font-medium">State</th>
                        <th className="px-4 py-3 font-medium">Vendor</th>
                        <th className="px-4 py-3 font-medium">Connection</th>
                        <th className="px-4 py-3 font-medium text-right">PDD</th>
                        <th className="px-4 py-3 font-medium text-right">Duration</th>
                        {isPrimary && <th className="px-3 py-3 font-medium w-10"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {displayed.map((call, i) => {
                        const origCountry = call.caller ? lookupCountry(call.caller) : null;
                        const destCountry = call.callee ? lookupCountry(call.callee) : null;
                        const acctFirst = String(call.accountId || '').charAt(0);
                        const trunkClass = acctFirst === '1' ? { label: 'First',    color: 'text-blue-400 bg-blue-500/10' }
                          : acctFirst === '2' ? { label: 'Business', color: 'text-violet-400 bg-violet-500/10' }
                          : acctFirst === '7' ? { label: 'Charlie',  color: 'text-orange-400 bg-orange-500/10' }
                          : null;
                        const rowKey = call.id || String(i);
                        const isExpanded = expandedCallId === rowKey;
                        const dirStyle = call.direction ? DIRECTION_STYLE[call.direction] : null;
                        const pddSec = call.delay ?? 0;
                        const pddDisplay = pddSec > 0
                          ? pddSec >= 1 ? `${pddSec.toFixed(1)}s` : `${Math.round(pddSec * 1000)}ms`
                          : null;
                        const totalCols = isPrimary ? 15 : 14;
                        return (
                        <Fragment key={rowKey}>
                        <tr
                          className={`hover:bg-muted/20 transition-colors text-xs cursor-pointer ${isExpanded ? 'bg-muted/10' : ''}`}
                          onClick={() => setExpandedCallId(isExpanded ? null : rowKey)}
                          data-testid={`row-live-${i}`}
                        >
                          <td className="px-3 py-3 text-center text-muted-foreground/40">
                            {isExpanded
                              ? <ChevronDown className="w-3.5 h-3.5 mx-auto" />
                              : <ChevronRight className="w-3.5 h-3.5 mx-auto" />}
                          </td>
                          <td className="px-3 py-3 text-center text-muted-foreground/50">{i + 1}</td>
                          <td className="px-4 py-3">
                            {call.clientName ? (
                              <span className="font-medium text-foreground" data-testid={`cell-caller-${i}`}>{call.clientName}</span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-foreground/80" data-testid={`cell-cli-${i}`}>{call.caller || '—'}</td>
                          <td className="px-4 py-3 font-mono text-foreground/80" data-testid={`cell-cld-${i}`}>{call.callee || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-orig-country-${i}`}>
                            {origCountry ? (
                              <span className="flex items-center gap-1">
                                <Globe className="w-3 h-3 opacity-50" />
                                {origCountry}
                              </span>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-dest-country-${i}`}>
                            {destCountry ? (
                              <span className="flex items-center gap-1">
                                <Globe className="w-3 h-3 opacity-50" />
                                {destCountry}
                              </span>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-3" data-testid={`cell-trunk-${i}`}>
                            {trunkClass ? (
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${trunkClass.color}`}>
                                {trunkClass.label}
                              </span>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-3" data-testid={`cell-direction-${i}`}>
                            {dirStyle ? (
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${dirStyle.color}`}>
                                {dirStyle.icon === 'in'
                                  ? <ArrowDownLeft className="w-2.5 h-2.5" />
                                  : <ArrowUpRight className="w-2.5 h-2.5" />}
                                {dirStyle.label}
                              </span>
                            ) : call.direction ? (
                              <span className="text-[10px] text-muted-foreground">{call.direction}</span>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {(() => {
                              const st = CC_STATE_STYLE[call.ccState || ''] ?? (call.callStatus === 'connected'
                                ? CC_STATE_STYLE.Connected
                                : CC_STATE_STYLE.WaitRoute);
                              return (
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${st.badge}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                                  {st.label}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-vendor-${i}`}>{call.vendor || <span className="text-muted-foreground/30">—</span>}</td>
                          <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-connection-${i}`}>{call.connection || <span className="text-muted-foreground/30">—</span>}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground font-mono" data-testid={`cell-pdd-${i}`}>
                            {pddDisplay ?? <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-foreground/70" data-testid={`cell-duration-${i}`}>
                            {formatDuration(call.duration)}
                          </td>
                          {isPrimary && (
                            <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                              {call.id ? (
                                <button
                                  onClick={() => disconnectCallMutation.mutate(call.id)}
                                  disabled={disconnectingCallId === call.id}
                                  title="Disconnect call"
                                  className="p-1 rounded hover:bg-rose-500/10 text-muted-foreground/40 hover:text-rose-400 transition-colors disabled:opacity-50"
                                  data-testid={`button-disconnect-${i}`}
                                >
                                  {disconnectingCallId === call.id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <PhoneOff className="w-3.5 h-3.5" />}
                                </button>
                              ) : null}
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr key={`${rowKey}-detail`} className="bg-muted/5 border-b border-border/20">
                            <td colSpan={totalCols} className="px-6 py-3">
                              <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-muted-foreground">
                                {call.callId && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-muted-foreground/50 uppercase tracking-wide text-[10px]">Call-ID</span>
                                    <span className="font-mono text-foreground/60 truncate max-w-[200px]">{call.callId}</span>
                                  </div>
                                )}
                                {call.setupTime && (
                                  <div className="flex items-center gap-1.5">
                                    <Clock className="w-3 h-3 opacity-50" />
                                    <span className="text-muted-foreground/50 uppercase tracking-wide text-[10px]">Setup</span>
                                    <span className="font-mono text-foreground/60">{call.setupTime}</span>
                                  </div>
                                )}
                                {(call.mediaIpCaller || call.mediaIpCallee) && (
                                  <div className="flex items-center gap-1.5">
                                    <Network className="w-3 h-3 opacity-50" />
                                    <span className="text-muted-foreground/50 uppercase tracking-wide text-[10px]">Media</span>
                                    <span className="font-mono text-foreground/60">
                                      {call.mediaIpCaller || '?'} → {call.mediaIpCallee || '?'}
                                    </span>
                                  </div>
                                )}
                                {call.codec && call.codec !== '-' && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-muted-foreground/50 uppercase tracking-wide text-[10px]">Codec</span>
                                    <span className="text-foreground/60">{call.codec}</span>
                                  </div>
                                )}
                                {call.iCustomer && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-muted-foreground/50 uppercase tracking-wide text-[10px]">Customer</span>
                                    <span className="font-mono text-foreground/60">#{call.iCustomer}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        );
                      })}
                      {displayed.length === 0 && (
                        <tr>
                          <td colSpan={isPrimary ? 15 : 14} className="px-6 py-12 text-center text-muted-foreground">
                            No active calls match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}

    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CallsListPage() {
  const [selectedSwitch, setSelectedSwitch] = useState<number | 'primary'>('primary');

  const { data: switches = [] } = useQuery<SwitchRecord[]>({
    queryKey: ['/api/switches'],
    refetchInterval: 60000,
  });

  const primaryLabel = 'Primary Sippy';

  const { data: primarySippySession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
  });
  const primarySessionActive = !!primarySippySession?.active;

  const enabledSwitches = switches.filter(sw => sw.enabled !== false);

  const currentSwitchInfo = selectedSwitch === 'primary'
    ? { name: 'Primary', type: 'sippy', active: primarySessionActive }
    : enabledSwitches.find(sw => sw.id === selectedSwitch);

  const currentName = selectedSwitch === 'primary' ? primaryLabel : (currentSwitchInfo as SwitchRecord)?.name ?? 'Switch';
  const currentType = selectedSwitch === 'primary' ? 'sippy' : (currentSwitchInfo as SwitchRecord)?.type ?? 'sippy';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Active Calls</h2>
          <p className="text-muted-foreground mt-1">Real-time monitoring across all configured switches.</p>
        </div>
      </div>

      {/* ── Switch Tab Bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {/* Primary tab */}
        <button
          onClick={() => setSelectedSwitch('primary')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all flex-shrink-0 ${
            selectedSwitch === 'primary'
              ? 'bg-primary/10 border-primary/30 text-primary shadow-sm'
              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80'
          }`}
          data-testid="tab-switch-primary"
        >
          <Server className="w-4 h-4" />
          <span>{primaryLabel}</span>
          <span className="text-xs text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded border border-border/40">
            Sippy
          </span>
          {primarySessionActive ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50 bg-muted/40 px-1.5 py-0.5 rounded-full border border-border/50">
              Offline
            </span>
          )}
        </button>

        {/* Additional switch tabs */}
        {enabledSwitches.map(sw => (
          <SwitchTab
            key={sw.id}
            sw={sw}
            isSelected={selectedSwitch === sw.id}
            onSelect={() => setSelectedSwitch(sw.id)}
          />
        ))}

        {enabledSwitches.length === 0 && (
          <p className="text-xs text-muted-foreground/50 italic px-2">
            Add switches in Settings to monitor multiple switches simultaneously.
          </p>
        )}
      </div>

      {/* ── Active Switch Panel ────────────────────────────────────────────── */}
      <SwitchPanel
        key={String(selectedSwitch)}
        switchId={selectedSwitch}
        switchType={currentType}
        switchName={currentName}
      />
    </div>
  );
}

// ─── Switch Tab Button (separate component for per-switch session query) ──────

function SwitchTab({
  sw,
  isSelected,
  onSelect,
}: {
  sw: SwitchRecord;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { data: session } = useQuery<{ active: boolean }>({
    queryKey: ['/api/switches', sw.id, 'session'],
    refetchInterval: 30000,
    queryFn: () => fetch(`/api/switches/${sw.id}/session`).then(r => r.json()),
  });

  const isLive = !!session?.active || sw.type === 'sippy';

  return (
    <button
      onClick={onSelect}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all flex-shrink-0 ${
        isSelected
          ? 'bg-primary/10 border-primary/30 text-primary shadow-sm'
          : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80'
      }`}
      data-testid={`tab-switch-${sw.id}`}
    >
      <Server className="w-4 h-4" />
      <span>{sw.name}</span>
      <span className="text-xs text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded border border-border/40">
        Sippy
      </span>
      {isLive ? (
        <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/50 bg-muted/40 px-1.5 py-0.5 rounded-full border border-border/50">
          Offline
        </span>
      )}
    </button>
  );
}
