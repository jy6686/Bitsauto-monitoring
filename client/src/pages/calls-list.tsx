import {
  Phone, Clock, Search, BarChart3, List, RefreshCw, CheckCircle2,
  ArrowRightLeft, Globe, Server, Loader2, AlertCircle,
  ChevronDown, ChevronRight, PhoneOff, ArrowUpRight, ArrowDownLeft, Network,
  Activity, Wifi, Info, HeartPulse, ShieldAlert, Timer, SignalHigh, History,
  TrendingUp, BarChart2, ThumbsUp, ThumbsDown, Mic2, Plus, Check, SlidersHorizontal,
} from "lucide-react";
import { useState, useRef, useEffect, Fragment } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { BseTooltip, BSE_GRID_PROPS, BSE_AXIS_PROPS, BSE_CURSOR, bseActiveDot } from "@/components/bse-chart";
import { lookupCountry, lookupCLD } from "@/lib/country-lookup";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useNocWebSocket } from "@/hooks/use-noc-ws";

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
  iEnvironment?: string; // Environment ID (I_ENVIRONMENT)
  vendor?: string;
  connection?: string;
  direction?: string;    // DIRECTION: vendor | onnet_in | onnet_out | originate
  mediaIpCaller?: string;
  mediaIpCallee?: string;
  delay?: number;        // DELAY in seconds (PDD)
  setupTime?: string;    // SETUP_TIME timestamp
  codec?: string;
  state?: string;
  // Destination enrichment from dial-codes.json
  destCountry?:  string | null;
  destBreakout?: string | null;
  destFull?:     string | null;
  trunkClass?:   string | null;   // e.g. "First Class Wholesale"
  trunkPrefix?:  string | null;   // '1' | '2' | '6' | '7'
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

// ─── IP Geolocation Badge ─────────────────────────────────────────────────────

interface IpLookupData {
  status: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  isp?: string;
  org?: string;
  as?: string;
  query?: string;
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '';
  const base = 0x1F1E6;
  return String.fromCodePoint(base + code.toUpperCase().charCodeAt(0) - 65) +
         String.fromCodePoint(base + code.toUpperCase().charCodeAt(1) - 65);
}

function IpInfoBadge({ ip, color = 'blue' }: { ip: string; color?: 'blue' | 'green' }) {
  const { data, isLoading } = useQuery<IpLookupData>({
    queryKey: ['/api/ip-lookup', ip],
    queryFn: async () => {
      const res = await fetch(`/api/ip-lookup?ip=${encodeURIComponent(ip)}`);
      return res.json();
    },
    staleTime: 3600_000,
    enabled: !!ip,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-[9px] text-muted-foreground/30 italic">
        <Loader2 className="w-2.5 h-2.5 animate-spin" /> resolving…
      </div>
    );
  }
  if (!data || data.status !== 'success') return null;

  const flag = countryFlag(data.countryCode || '');
  const rawIsp = data.isp || data.org || '';
  const isp = rawIsp.replace(/,?\s+(LLC|Inc\.?|Ltd\.?|Corp\.?|Co\.)$/gi, '').trim();
  const asNum = (data.as || '').split(' ')[0];
  const location = [data.city, data.country].filter(Boolean).join(', ');
  const countryColor = color === 'green' ? 'text-emerald-300/80' : 'text-cyan-300/80';

  return (
    <div className="space-y-0.5">
      <div className={`text-[11px] font-medium ${countryColor} flex items-center gap-1`}>
        <span className="text-base leading-none">{flag}</span>
        <span>{location}</span>
      </div>
      {isp && (
        <div className="text-[9px] text-muted-foreground/50 flex items-center gap-1" title={`${data.isp}${asNum ? ' · ' + asNum : ''}`}>
          <Globe className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
          <span className="truncate max-w-[150px]">{isp}</span>
          {asNum && <span className="text-muted-foreground/30 flex-shrink-0">· {asNum}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSummary(calls: LiveCall[]): SummaryRow[] {
  const map = new Map<string, SummaryRow>();
  for (const c of calls) {
    // Resolve client label — try multiple fallbacks before giving up
    let client = c.clientName;
    if (!client && c.caller && c.caller !== '-') client = c.caller;
    if (!client && c.vendor) client = c.vendor;
    if (!client && c.connection) client = c.connection;
    if (!client) client = c.callStatus === 'routing' ? 'Routing Traffic' : 'Unknown';

    const destInfo = lookupCLD(c.callee);
    const dest = destInfo.country;
    const country = dest?.name ?? (c.callee && c.callee !== '-' ? 'Intl' : 'Unknown');
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

// Parses Sippy's non-standard setup time "20260411T20:20:32.055" → Date
function parseSippyTime(setupTime: string): number | null {
  // Insert dashes: "20260411T..." → "2026-04-11T..."
  const normalized = setupTime.replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T');
  const t = new Date(normalized).getTime();
  return isNaN(t) ? null : t;
}

// Real-time ticking duration — uses setupTime to compute elapsed locally so
// the counter never freezes between API polls.
function LiveDuration({ setupTime, durationSecs }: { setupTime?: string; durationSecs: number }) {
  const startRef = useRef<number | null>(null);
  if (setupTime && startRef.current === null) {
    startRef.current = parseSippyTime(setupTime);
  }

  const [elapsed, setElapsed] = useState<number>(() => {
    if (setupTime) {
      const start = parseSippyTime(setupTime);
      if (start !== null) return Math.max(0, Math.floor((Date.now() - start) / 1000));
    }
    return durationSecs;
  });

  useEffect(() => {
    const start = setupTime ? parseSippyTime(setupTime) : null;
    if (start !== null) {
      const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    } else {
      // No setupTime — count up from last-known duration
      setElapsed(durationSecs);
      const id = setInterval(() => setElapsed(v => v + 1), 1000);
      return () => clearInterval(id);
    }
  }, [setupTime]);

  return <>{formatDuration(elapsed)}</>;
}

// ─── Switch Panel (per-switch live call view) ─────────────────────────────────

const VALID_VIEWS = ['summary', 'details', 'quality', 'history'] as const;
type ViewTab = typeof VALID_VIEWS[number];
function parseViewParam(search: string): ViewTab {
  const v = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('view') ?? '';
  return (VALID_VIEWS as readonly string[]).includes(v) ? (v as ViewTab) : 'summary';
}

function SwitchPanel({
  switchId,
  switchType,
  switchName,
}: {
  switchId: number | 'primary';
  switchType: string;
  switchName: string;
}) {
  const [, navigate] = useLocation();
  const urlQuery = useSearch();     // e.g. "view=details" — updates on every URL change

  const [callViewTab, setCallViewTab] = useState<ViewTab>(() => parseViewParam(urlQuery));
  const [historyHours, setHistoryHours] = useState(24);
  const [routeAnalysisMode, setRouteAnalysisMode] = useState(false);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const viewDropdownRef = useRef<HTMLDivElement>(null);

  // Sync tab whenever the ?view= query string changes (sidebar subitem clicks)
  useEffect(() => {
    const next = parseViewParam(urlQuery);
    if (next !== callViewTab) setCallViewTab(next);
  }, [urlQuery]);

  function selectView(v: ViewTab) {
    setCallViewTab(v);
    setViewDropdownOpen(false);
    navigate(`/calls?view=${v}`);
  }

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (viewDropdownRef.current && !viewDropdownRef.current.contains(e.target as Node)) {
        setViewDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);
  const [search, setSearch] = useState('');
  const [filterCli, setFilterCli] = useState('');
  const [filterCld, setFilterCld] = useState('');
  const [filterState, setFilterState] = useState('all');
  const [filterVendor, setFilterVendor] = useState('all');
  const [filterConnection, setFilterConnection] = useState('all');
  const [filterDirection, setFilterDirection] = useState('all');
  const [showLatestFirst, setShowLatestFirst] = useState(false);

  // ── Column visibility (chip picker) ──────────────────────────────────────────
  const COLUMN_CHIPS = [
    { key: 'account',     label: 'Account'     },
    { key: 'origCountry', label: 'Orig Country' },
    { key: 'destCountry', label: 'Dest Country' },
    { key: 'breakout',    label: 'Breakout'     },
    { key: 'trunk',       label: 'Trunk'        },
    { key: 'direction',   label: 'Direction'    },
    { key: 'vendor',      label: 'Vendor'       },
    { key: 'connection',  label: 'Connection'   },
    { key: 'pdd',         label: 'PDD'          },
  ] as const;
  type ColKey = typeof COLUMN_CHIPS[number]['key'];
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    new Set<ColKey>(['account', 'destCountry', 'breakout', 'trunk', 'direction', 'vendor', 'connection', 'pdd'])
  );
  function toggleCol(key: ColKey) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  const col = (key: ColKey) => visibleCols.has(key);
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

  // NOC WebSocket — server pushes a tick every ~60s when the background poller updates.
  // This replaces the 15s refetchInterval on live-calls, eliminating per-user Sippy calls.
  const { lastTick } = useNocWebSocket();

  // Primary Sippy: session used only for the "Live" badge — live calls fetch independently
  const { data: primarySippySession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 60000,
    enabled: isPrimary,
  });
  const { data: primarySippyLiveCalls, isLoading: sippyLoading, refetch: refetchSippy } = useQuery<{ calls: LiveCall[]; connected?: boolean }>({
    queryKey: ['/api/sippy/live-calls'],
    enabled: isPrimary,
    staleTime: 50_000,
  });
  // Trigger live-calls refetch whenever the server pushes a NOC tick
  useEffect(() => {
    if (lastTick && isPrimary) refetchSippy();
  }, [lastTick]);

  // Secondary switch: use per-switch endpoints (keep polling — no WS for secondary)
  const { data: switchLiveCalls, isLoading: switchLoading, refetch: refetchSwitch } = useQuery<{ calls: LiveCall[]; error?: string }>({
    queryKey: ['/api/switches', switchId, 'live-calls'],
    refetchInterval: 60000,
    enabled: !isPrimary,
    queryFn: () => fetch(`/api/switches/${switchId}/live-calls`).then(r => r.json()),
  });

  // Call History — always at top level (Rules of Hooks)
  const { data: histData, isLoading: histLoading, refetch: refetchHist } = useQuery<{
    calls: Array<{
      id: number; sippyCallId: string; caller: string | null; callee: string | null;
      clientName: string | null; vendor: string | null; accountId: string | null;
      direction: string | null; codec: string | null; ccState: string | null;
      maxDurationSecs: number | null; pddMs: number | null;
      mediaIpCaller: string | null; mediaIpCallee: string | null;
      connection: string | null; firstSeen: string; lastSeen: string;
    }>;
    hoursBack: number;
  }>({
    queryKey: ['/api/call-history', historyHours],
    queryFn: () => fetch(`/api/call-history?hours=${historyHours}`).then(r => r.json()),
    refetchInterval: 60000,
  });

  interface RouteQuality {
    vendor: string; callCount: number; avgPddMs: number; p95PddMs: number; maxPddMs: number;
    goodCalls: number; badCalls: number; goodPct: number;
    codecs: Record<string, number>; connections: string[]; clients: string[];
    hourlyBuckets: { hour: string; callCount: number; avgPddMs: number; goodPct: number }[];
  }
  const { data: rqData, isLoading: rqLoading, refetch: refetchRQ } = useQuery<{
    routes: RouteQuality[]; hoursBack: number; totalCalls: number;
  }>({
    queryKey: ['/api/call-history/route-quality', historyHours],
    queryFn: () => fetch(`/api/call-history/route-quality?hours=${historyHours}`).then(r => r.json()),
    enabled: routeAnalysisMode,
    refetchInterval: 60000,
  });

  // For primary: use the 'connected' field from the live calls response (most accurate);
  // fall back to session.active while the first live-calls fetch is in flight
  const isActive = isPrimary
    ? (primarySippyLiveCalls !== undefined ? !!primarySippyLiveCalls.connected : !!primarySippySession?.active)
    : true;
  const isLoading = isPrimary ? sippyLoading : switchLoading;

  const handleRefresh = () => isPrimary ? refetchSippy() : refetchSwitch();

  const liveCallData = isPrimary ? primarySippyLiveCalls : switchLiveCalls;

  // Viewer account filtering — show only calls for assigned accounts
  const { role } = useAuth();
  const { data: viewerAccounts } = useQuery<{ accountIds: string[]; clientNames: string[]; kamName: string | null }>({
    queryKey: ['/api/user/assigned-accounts'],
    enabled: role === 'viewer',
  });
  const viewerAccountIds = new Set(viewerAccounts?.accountIds ?? []);

  // Build live calls list (filtered by assigned accounts for viewer role)
  const allLiveCalls: LiveCall[] = liveCallData?.calls ?? [];
  const liveCalls: LiveCall[] = (role === 'viewer' && viewerAccountIds.size > 0)
    ? allLiveCalls.filter(c => viewerAccountIds.has(String(c.accountId)))
    : allLiveCalls;

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

      {/* View selector dropdown + controls */}
      <div className="flex items-center justify-between gap-3">
        {/* Dropdown */}
        <div className="relative" ref={viewDropdownRef}>
          <button
            onClick={() => setViewDropdownOpen(o => !o)}
            className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-card border border-border hover:bg-muted/40 transition-colors text-sm font-medium min-w-[200px] justify-between"
            data-testid="dropdown-view-selector"
          >
            <span className="flex items-center gap-2">
              {callViewTab === 'summary'  && <><BarChart3   className="w-4 h-4 text-violet-400" />Active Call Summary</>}
              {callViewTab === 'details'  && <><List         className="w-4 h-4 text-cyan-400"   />Active Call Details</>}
              {callViewTab === 'quality'  && <><HeartPulse   className="w-4 h-4 text-rose-400"   />Quality Monitoring</>}
              {callViewTab === 'history'  && <><History       className="w-4 h-4 text-amber-400"  />Call History</>}
            </span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${viewDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {viewDropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-[220px] bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden py-1">
              {([
                { key: 'summary',  label: 'Active Call Summary', icon: <BarChart3  className="w-4 h-4 text-violet-400" /> },
                { key: 'details',  label: 'Active Call Details',  icon: <List       className="w-4 h-4 text-cyan-400"   /> },
                { key: 'quality',  label: 'Quality Monitoring',   icon: <HeartPulse className="w-4 h-4 text-rose-400"   /> },
                { key: 'history',  label: 'Call History',         icon: <History    className="w-4 h-4 text-amber-400"  /> },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => selectView(opt.key)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left ${
                    callViewTab === opt.key
                      ? 'bg-violet-500/10 text-violet-300'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                  }`}
                  data-testid={`dropdown-option-${opt.key}`}
                >
                  {opt.icon}
                  {opt.label}
                  {callViewTab === opt.key && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {callViewTab === 'details' && (
            <div className="relative w-56">
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
                {!isActive
                  ? 'Connect to this switch to see live calls.'
                  : switchType === 'sippy'
                  ? 'No active calls on this Sippy switch right now.'
                  : 'No active calls on the switch right now.'}
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
                {/* ── Column Chip Picker ── */}
                <div className="border-b border-border/50 bg-muted/5 px-5 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium shrink-0 mr-1">
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      Columns:
                    </div>
                    {COLUMN_CHIPS.map(chip => {
                      const isOn = col(chip.key);
                      return (
                        <button
                          key={chip.key}
                          onClick={() => toggleCol(chip.key)}
                          data-testid={`chip-col-${chip.key}`}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all select-none cursor-pointer ${
                            isOn
                              ? 'bg-primary/10 border-primary/40 text-primary'
                              : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                          }`}
                        >
                          {isOn
                            ? <Check className="w-2.5 h-2.5" />
                            : <Plus className="w-2.5 h-2.5" />}
                          {chip.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

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
                        {col('account')     && <th className="px-4 py-3 font-medium">Account</th>}
                        <th className="px-4 py-3 font-medium">CLI</th>
                        <th className="px-4 py-3 font-medium">CLD</th>
                        {col('origCountry') && <th className="px-4 py-3 font-medium">Orig Country</th>}
                        {col('destCountry') && <th className="px-4 py-3 font-medium">Dest Country</th>}
                        {col('breakout')    && <th className="px-4 py-3 font-medium">Breakout</th>}
                        {col('trunk')       && <th className="px-4 py-3 font-medium">Trunk</th>}
                        {col('direction')   && <th className="px-4 py-3 font-medium">Direction</th>}
                        <th className="px-4 py-3 font-medium">State</th>
                        {col('vendor')      && <th className="px-4 py-3 font-medium">Vendor</th>}
                        {col('connection')  && <th className="px-4 py-3 font-medium">Connection</th>}
                        {col('pdd')         && <th className="px-4 py-3 font-medium text-right">PDD</th>}
                        <th className="px-4 py-3 font-medium text-right">Duration</th>
                        {isPrimary && <th className="px-3 py-3 font-medium w-10"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {displayed.map((call, i) => {
                        const origCountry = call.caller ? lookupCountry(call.caller) : null;
                        const cldInfo    = lookupCLD(call.callee);
                        const destCountry = cldInfo.country;
                        const serverDest = call.destFull || call.destCountry || null;
                        const trunkClass = cldInfo.trunkClass;
                        const rowKey = call.id || String(i);
                        const isExpanded = expandedCallId === rowKey;
                        const dirStyle = call.direction ? DIRECTION_STYLE[call.direction] : null;
                        const pddSec = call.delay ?? 0;
                        const pddDisplay = pddSec > 0
                          ? pddSec >= 1 ? `${pddSec.toFixed(1)}s` : `${Math.round(pddSec * 1000)}ms`
                          : null;
                        const totalCols = 6 + visibleCols.size + (isPrimary ? 1 : 0);
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
                          {col('account') && (
                            <td className="px-4 py-3">
                              {call.clientName ? (
                                <span className="font-medium text-foreground" data-testid={`cell-caller-${i}`}>{call.clientName}</span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                          )}
                          <td className="px-4 py-3 font-mono text-foreground/80" data-testid={`cell-cli-${i}`}>{call.caller || '—'}</td>
                          <td className="px-4 py-3 font-mono text-foreground/80" data-testid={`cell-cld-${i}`}>{call.callee || '—'}</td>
                          {col('origCountry') && (
                            <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-orig-country-${i}`}>
                              {origCountry ? (
                                <span className="flex items-center gap-1">
                                  <span>{origCountry.flag}</span>
                                  {origCountry.name}
                                </span>
                              ) : <span className="text-muted-foreground/30">—</span>}
                            </td>
                          )}
                          {col('destCountry') && (
                            <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-dest-country-${i}`}>
                              {destCountry ? (
                                <span className="flex items-center gap-1 text-[11px]">
                                  <span>{destCountry.flag}</span>
                                  <span className="font-medium text-cyan-300/90">{destCountry.name}</span>
                                </span>
                              ) : serverDest ? (
                                <span className="text-cyan-300/80 font-medium text-[11px]">{call.destCountry || serverDest}</span>
                              ) : <span className="text-muted-foreground/30">—</span>}
                            </td>
                          )}
                          {col('breakout') && (
                            <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-breakout-${i}`}>
                              {call.destBreakout ? (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20 whitespace-nowrap">{call.destBreakout}</span>
                              ) : <span className="text-muted-foreground/30">—</span>}
                            </td>
                          )}
                          {col('trunk') && (
                            <td className="px-4 py-3" data-testid={`cell-trunk-${i}`}>
                              {trunkClass ? (
                                <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${trunkClass.color}`}>
                                  {trunkClass.label}
                                </span>
                              ) : <span className="text-muted-foreground/30">—</span>}
                            </td>
                          )}
                          {col('direction') && (
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
                          )}
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
                          {col('vendor') && (
                            <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-vendor-${i}`}>{call.vendor || <span className="text-muted-foreground/30">—</span>}</td>
                          )}
                          {col('connection') && (
                            <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-connection-${i}`}>{call.connection || <span className="text-muted-foreground/30">—</span>}</td>
                          )}
                          {col('pdd') && (
                            <td className="px-4 py-3 text-right text-muted-foreground font-mono" data-testid={`cell-pdd-${i}`}>
                              {pddDisplay ?? <span className="text-muted-foreground/30">—</span>}
                            </td>
                          )}
                          <td className="px-4 py-3 text-right font-mono text-foreground/70" data-testid={`cell-duration-${i}`}>
                            <LiveDuration setupTime={call.setupTime} durationSecs={call.duration} />
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
                            <td colSpan={totalCols} className="px-4 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

                                {/* ── Panel 1: Call Identity ── */}
                                <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                                    <Phone className="w-3 h-3" /> Call Identity
                                  </p>
                                  {call.callId && (
                                    <div className="space-y-0.5">
                                      <p className="text-[10px] text-muted-foreground/50 uppercase">SIP Call-ID</p>
                                      <p className="font-mono text-[11px] text-foreground/70 truncate" title={call.callId}>{call.callId}</p>
                                    </div>
                                  )}
                                  {call.setupTime && (
                                    <div className="space-y-0.5">
                                      <p className="text-[10px] text-muted-foreground/50 uppercase">Setup Time</p>
                                      <p className="font-mono text-[11px] text-foreground/70">{call.setupTime}</p>
                                    </div>
                                  )}
                                  <div className="flex gap-3 flex-wrap">
                                    {call.iCustomer && (
                                      <div className="space-y-0.5">
                                        <p className="text-[10px] text-muted-foreground/50 uppercase">Customer ID</p>
                                        <p className="font-mono text-[11px] text-foreground/70">#{call.iCustomer}</p>
                                      </div>
                                    )}
                                    {call.iEnvironment && (
                                      <div className="space-y-0.5">
                                        <p className="text-[10px] text-muted-foreground/50 uppercase">Environment</p>
                                        <p className="font-mono text-[11px] text-foreground/70">#{call.iEnvironment}</p>
                                      </div>
                                    )}
                                    {call.direction && (
                                      <div className="space-y-0.5">
                                        <p className="text-[10px] text-muted-foreground/50 uppercase">Direction</p>
                                        <p className="text-[11px] text-foreground/70 capitalize">{call.direction.replace(/_/g,' ')}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* ── Panel 2: RTP Monitoring ── */}
                                <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-3">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                                    <Wifi className="w-3 h-3 text-cyan-400" /> RTP Monitoring
                                  </p>

                                  {/* RTP Media Path */}
                                  <div className="space-y-1.5">
                                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40">RTP Media Path</p>
                                    {(call.mediaIpCaller || call.mediaIpCallee) ? (
                                      <div className="space-y-2">
                                        {call.mediaIpCaller === call.mediaIpCallee ? (
                                          /* Same proxy on both sides — one card */
                                          <div className="rounded-md bg-cyan-500/5 border border-cyan-500/15 p-2 space-y-1.5">
                                            <div className="flex items-center gap-1.5">
                                              <Server className="w-3 h-3 text-cyan-400/60 flex-shrink-0" />
                                              <span className="font-mono text-[11px] text-cyan-300">{call.mediaIpCaller}</span>
                                              <span className="ml-auto text-[9px] text-muted-foreground/30 italic">caller ↔ callee</span>
                                            </div>
                                            <IpInfoBadge ip={call.mediaIpCaller!} color="blue" />
                                            <p className="text-[9px] text-muted-foreground/30 italic pt-0.5">Media proxied through Sippy</p>
                                          </div>
                                        ) : (
                                          /* Different IPs — two cards */
                                          <div className="space-y-1.5">
                                            {call.mediaIpCaller && (
                                              <div className="rounded-md bg-blue-500/5 border border-blue-500/15 p-2 space-y-1.5">
                                                <div className="flex items-center gap-1.5">
                                                  <Server className="w-3 h-3 text-blue-400/60 flex-shrink-0" />
                                                  <span className="font-mono text-[11px] text-blue-300">{call.mediaIpCaller}</span>
                                                  <span className="ml-auto text-[9px] text-muted-foreground/30">Caller</span>
                                                </div>
                                                <IpInfoBadge ip={call.mediaIpCaller} color="blue" />
                                              </div>
                                            )}
                                            <div className="flex justify-center">
                                              <ArrowRightLeft className="w-3 h-3 text-muted-foreground/20" />
                                            </div>
                                            {call.mediaIpCallee && (
                                              <div className="rounded-md bg-emerald-500/5 border border-emerald-500/15 p-2 space-y-1.5">
                                                <div className="flex items-center gap-1.5">
                                                  <Server className="w-3 h-3 text-emerald-400/60 flex-shrink-0" />
                                                  <span className="font-mono text-[11px] text-emerald-300">{call.mediaIpCallee}</span>
                                                  <span className="ml-auto text-[9px] text-muted-foreground/30">Callee</span>
                                                </div>
                                                <IpInfoBadge ip={call.mediaIpCallee} color="green" />
                                              </div>
                                            )}
                                            <p className="text-[9px] text-muted-foreground/30 italic">Media proxied through Sippy</p>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="text-[11px] text-muted-foreground/30 italic">Media IPs not reported</p>
                                    )}
                                  </div>

                                  {/* Connection + Codec */}
                                  <div className="flex gap-3 flex-wrap pt-0.5 border-t border-border/20">
                                    {call.connection && (
                                      <div className="space-y-0.5">
                                        <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Connection</p>
                                        <p className="text-[11px] text-foreground/70 font-mono">#{call.connection}</p>
                                      </div>
                                    )}
                                    {call.codec && call.codec !== '-' && (
                                      <div className="space-y-0.5">
                                        <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Codec</p>
                                        <p className="text-[11px] text-foreground/70 font-mono">{call.codec}</p>
                                      </div>
                                    )}
                                    {call.vendor && (
                                      <div className="space-y-0.5">
                                        <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Vendor</p>
                                        <p className="text-[11px] text-foreground/70">{call.vendor}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* ── Panel 3: Quality Signals ── */}
                                <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-3">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                                    <Activity className="w-3 h-3" /> Quality Signals
                                  </p>

                                  {/* PDD */}
                                  {(() => {
                                    const pdd = call.delay ?? 0;
                                    const pddMs = Math.round(pdd * 1000);
                                    const grade = pddMs === 0 ? null
                                      : pddMs < 500  ? { label: 'Excellent', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' }
                                      : pddMs < 1000 ? { label: 'Good',      color: 'text-green-400',   bg: 'bg-green-500/10 border-green-500/30' }
                                      : pddMs < 2000 ? { label: 'Fair',      color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30' }
                                      : pddMs < 3000 ? { label: 'Poor',      color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/30' }
                                      :               { label: 'Critical',   color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30' };
                                    return (
                                      <div className="flex items-center justify-between">
                                        <div>
                                          <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Setup Latency (PDD)</p>
                                          <p className="font-mono text-[13px] font-semibold text-foreground/80 mt-0.5">
                                            {pddMs > 0 ? `${pddMs} ms` : '—'}
                                          </p>
                                        </div>
                                        {grade && (
                                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${grade.color} ${grade.bg}`}>
                                            {grade.label}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {/* MOS / Jitter / Packet Loss tiles */}
                                  {(() => {
                                    const pddMs = Math.round((call.delay ?? 0) * 1000);
                                    // ITU-T G.107 E-model estimate — uses PDD as signaling-delay proxy
                                    // One-way estimate ≈ PDD × 0.3 (PDD ≈ 3× one-way signaling propagation)
                                    let mos: number | null = null;
                                    if (pddMs > 0) {
                                      const d = pddMs * 0.3;
                                      const R = Math.max(0, Math.min(100,
                                        94.2 - 0.024 * d - 0.11 * (d > 177.3 ? d - 177.3 : 0)
                                      ));
                                      mos = Math.max(1, Math.min(4.5,
                                        Math.round((1 + 0.035 * R + 7e-6 * R * (R - 60) * (100 - R)) * 10) / 10
                                      ));
                                    }
                                    const mosGrade = mos === null ? null
                                      : mos >= 4.3 ? { label: 'Excellent', val: 'text-emerald-400', bar: 'bg-emerald-400' }
                                      : mos >= 4.0 ? { label: 'Good',      val: 'text-green-400',   bar: 'bg-green-400' }
                                      : mos >= 3.6 ? { label: 'Fair',      val: 'text-amber-400',   bar: 'bg-amber-400' }
                                      : mos >= 3.1 ? { label: 'Poor',      val: 'text-orange-400',  bar: 'bg-orange-400' }
                                      :              { label: 'Bad',        val: 'text-red-400',     bar: 'bg-red-400' };
                                    const mosBarPct = mos !== null ? Math.round(((mos - 1) / 3.5) * 100) : 0;

                                    return (
                                      <div className="grid grid-cols-3 gap-1.5">
                                        {/* MOS */}
                                        <div className="rounded-md bg-background/60 border border-border/30 p-2 space-y-1">
                                          <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">MOS</p>
                                          {mos !== null ? (
                                            <>
                                              <p className={`font-mono text-[15px] font-bold ${mosGrade?.val}`}>{mos.toFixed(1)}</p>
                                              <div className="h-1 rounded-full bg-muted/30 overflow-hidden">
                                                <div className={`h-full rounded-full transition-all ${mosGrade?.bar}`} style={{ width: `${mosBarPct}%` }} />
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <p className={`text-[8px] font-semibold ${mosGrade?.val}`}>{mosGrade?.label}</p>
                                                <p className="text-[7px] text-muted-foreground/30">est.</p>
                                              </div>
                                            </>
                                          ) : (
                                            <>
                                              <p className="font-mono text-[15px] font-bold text-muted-foreground/30">—</p>
                                              <p className="text-[8px] text-muted-foreground/25">No PDD data</p>
                                            </>
                                          )}
                                        </div>

                                        {/* Jitter */}
                                        <div className="rounded-md bg-background/60 border border-border/30 p-2 space-y-1">
                                          <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Jitter</p>
                                          <p className="font-mono text-[15px] font-bold text-muted-foreground/25">—</p>
                                          <p className="text-[7px] text-muted-foreground/25 leading-tight">RTCP-XR<br/>required</p>
                                        </div>

                                        {/* Packet Loss */}
                                        <div className="rounded-md bg-background/60 border border-border/30 p-2 space-y-1">
                                          <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Pkt Loss</p>
                                          <p className="font-mono text-[15px] font-bold text-muted-foreground/25">—</p>
                                          <p className="text-[7px] text-muted-foreground/25 leading-tight">RTCP-XR<br/>required</p>
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {/* Switch State */}
                                  <div className="flex items-center justify-between pt-0.5 border-t border-border/20">
                                    <div>
                                      <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Switch State</p>
                                      <p className="text-[11px] text-foreground/70 mt-0.5">{call.ccState || call.callStatus || '—'}</p>
                                    </div>
                                    <div className="flex items-center gap-1 text-[8px] text-muted-foreground/25">
                                      <Info className="w-2.5 h-2.5" />
                                      <span>MOS estimated via E-model</span>
                                    </div>
                                  </div>
                                </div>

                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        );
                      })}
                      {displayed.length === 0 && (
                        <tr>
                          <td colSpan={6 + visibleCols.size + (isPrimary ? 1 : 0)} className="px-6 py-12 text-center text-muted-foreground">
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

      {/* ── QUALITY MONITORING TAB ───────────────────────────────────────── */}
      {callViewTab === 'quality' && (() => {
        const activeCalls = liveCalls;

        // MOS estimate via ITU-T G.107 E-model (PDD as one-way delay proxy)
        function calcMOS(pddMs: number): number | null {
          if (pddMs <= 0) return null;
          const d = pddMs * 0.3;
          const R = Math.max(0, Math.min(100,
            94.2 - 0.024 * d - 0.11 * (d > 177.3 ? d - 177.3 : 0)
          ));
          return Math.max(1, Math.min(4.5,
            Math.round((1 + 0.035 * R + 7e-6 * R * (R - 60) * (100 - R)) * 10) / 10
          ));
        }

        function mosGrade(mos: number | null) {
          if (mos === null) return null;
          if (mos >= 4.3) return { label: 'Excellent', val: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', bar: 'bg-emerald-400' };
          if (mos >= 4.0) return { label: 'Good',      val: 'text-green-400',   bg: 'bg-green-500/10 border-green-500/20',   bar: 'bg-green-400' };
          if (mos >= 3.6) return { label: 'Fair',      val: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',   bar: 'bg-amber-400' };
          if (mos >= 3.1) return { label: 'Poor',      val: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/20', bar: 'bg-orange-400' };
          return              { label: 'Bad',       val: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',       bar: 'bg-red-400' };
        }

        function pddGrade(ms: number) {
          if (ms <= 0)    return null;
          if (ms < 500)   return { label: 'Excellent', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' };
          if (ms < 1000)  return { label: 'Good',      color: 'text-green-400',   bg: 'bg-green-500/10 border-green-500/20' };
          if (ms < 2000)  return { label: 'Fair',      color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20' };
          if (ms < 3000)  return { label: 'Poor',      color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/20' };
          return              { label: 'Critical',  color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20' };
        }

        // Aggregate stats
        const mosList = activeCalls
          .map(c => calcMOS(Math.round((c.delay ?? 0) * 1000)))
          .filter((v): v is number => v !== null);
        const avgMOS = mosList.length > 0
          ? Math.round((mosList.reduce((a, b) => a + b, 0) / mosList.length) * 10) / 10
          : null;
        const criticalPDD = activeCalls.filter(c => Math.round((c.delay ?? 0) * 1000) >= 3000).length;
        const poorMOS     = activeCalls.filter(c => { const m = calcMOS(Math.round((c.delay ?? 0) * 1000)); return m !== null && m < 3.6; }).length;
        const connected   = activeCalls.filter(c => c.ccState === 'Connected').length;
        const routing     = activeCalls.length - connected;

        return (
          <div className="space-y-4">
            {/* ── Summary cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {/* Total Calls */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Phone className="w-3 h-3" /> Total Calls
                </p>
                <p className="text-2xl font-bold text-foreground">{activeCalls.length}</p>
                <p className="text-[10px] text-muted-foreground/40">{connected} connected · {routing} routing</p>
              </div>
              {/* Avg MOS */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5">
                  <HeartPulse className="w-3 h-3 text-rose-400" /> Avg MOS
                </p>
                {avgMOS !== null ? (
                  <>
                    <p className={`text-2xl font-bold ${mosGrade(avgMOS)?.val ?? 'text-foreground'}`}>{avgMOS.toFixed(1)}</p>
                    <p className={`text-[10px] font-medium ${mosGrade(avgMOS)?.val ?? ''}`}>{mosGrade(avgMOS)?.label} <span className="text-muted-foreground/30 font-normal">est.</span></p>
                  </>
                ) : (
                  <p className="text-2xl font-bold text-muted-foreground/30">—</p>
                )}
              </div>
              {/* Critical PDD */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Timer className="w-3 h-3 text-orange-400" /> Critical PDD
                </p>
                <p className={`text-2xl font-bold ${criticalPDD > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{criticalPDD}</p>
                <p className="text-[10px] text-muted-foreground/40">calls ≥ 3000 ms</p>
              </div>
              {/* Poor MOS */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="w-3 h-3 text-amber-400" /> Poor MOS
                </p>
                <p className={`text-2xl font-bold ${poorMOS > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{poorMOS}</p>
                <p className="text-[10px] text-muted-foreground/40">calls MOS &lt; 3.6</p>
              </div>
              {/* RTCP-XR note */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5">
                  <SignalHigh className="w-3 h-3 text-cyan-400" /> Jitter / Loss
                </p>
                <p className="text-2xl font-bold text-muted-foreground/25">—</p>
                <p className="text-[10px] text-muted-foreground/30 leading-tight">Requires RTCP-XR feed</p>
              </div>
            </div>

            {/* ── Per-call quality table ── */}
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              {isLoading ? (
                <div className="p-12 text-center text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading quality data…
                </div>
              ) : activeCalls.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-14 h-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-3">
                    <HeartPulse className="w-7 h-7 text-muted-foreground/40" />
                  </div>
                  <p className="text-muted-foreground">No active calls to monitor.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/40 text-muted-foreground border-b border-border/50">
                      <tr>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">#</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Caller / Callee</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Client / Vendor</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Duration</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">SIP CC State</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">PDD</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider min-w-[120px]">MOS (est.)</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Jitter</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Pkt Loss</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Vendor RTP IP</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Issues</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {activeCalls.map((call, i) => {
                        const pddMs  = Math.round((call.delay ?? 0) * 1000);
                        const mos    = calcMOS(pddMs);
                        const mg     = mosGrade(mos);
                        const pg     = pddGrade(pddMs);
                        const mosPct = mos !== null ? Math.round(((mos - 1) / 3.5) * 100) : 0;
                        const ccStyle = CC_STATE_STYLE[call.ccState ?? ''] ?? CC_STATE_STYLE['ARComplete'];

                        // Detect issues
                        const issues: string[] = [];
                        if (pddMs >= 3000) issues.push('Critical PDD');
                        else if (pddMs >= 2000) issues.push('High PDD');
                        if (mos !== null && mos < 3.1) issues.push('Bad MOS');
                        else if (mos !== null && mos < 3.6) issues.push('Poor MOS');
                        if (call.ccState === 'WaitRoute') issues.push('Routing Delay');
                        if (call.ccState === 'WaitAuth')  issues.push('Auth Delay');

                        const rtpIp = call.mediaIpCallee || call.mediaIpCaller;

                        return (
                          <tr key={call.id ?? i} className="hover:bg-muted/20 transition-colors">
                            {/* # */}
                            <td className="px-3 py-3 text-muted-foreground/40 text-[11px] font-mono">{i + 1}</td>

                            {/* Caller / Callee */}
                            <td className="px-3 py-3">
                              <div className="space-y-0.5">
                                <p className="font-mono text-[11px] text-foreground/80">{call.caller}</p>
                                <p className="font-mono text-[11px] text-muted-foreground/50">→ {call.callee}</p>
                              </div>
                            </td>

                            {/* Client / Vendor */}
                            <td className="px-3 py-3">
                              <div className="space-y-0.5">
                                <p className="text-[11px] text-foreground/80 font-medium">{call.clientName || '—'}</p>
                                <p className="text-[11px] text-muted-foreground/50">{call.vendor || '—'}</p>
                              </div>
                            </td>

                            {/* Duration */}
                            <td className="px-3 py-3 font-mono text-[12px] text-foreground/70">
                              <LiveDuration setupTime={call.setupTime} durationSecs={call.duration} />
                            </td>

                            {/* SIP CC State */}
                            <td className="px-3 py-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ccStyle.badge}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${ccStyle.dot}`} />
                                {ccStyle.label}
                              </span>
                              {call.direction && (
                                <p className="text-[9px] text-muted-foreground/30 mt-0.5 capitalize">{call.direction.replace(/_/g, ' ')}</p>
                              )}
                            </td>

                            {/* PDD */}
                            <td className="px-3 py-3">
                              {pddMs > 0 ? (
                                <div className="space-y-0.5">
                                  <p className={`font-mono text-[12px] font-semibold ${pg?.color ?? 'text-foreground/70'}`}>
                                    {pddMs} ms
                                  </p>
                                  {pg && (
                                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${pg.color} ${pg.bg}`}>
                                      {pg.label}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground/30 text-[11px]">—</span>
                              )}
                            </td>

                            {/* MOS */}
                            <td className="px-3 py-3 min-w-[120px]">
                              {mos !== null ? (
                                <div className="space-y-1">
                                  <div className="flex items-baseline gap-1.5">
                                    <p className={`font-mono text-[13px] font-bold ${mg?.val}`}>{mos.toFixed(1)}</p>
                                    <span className={`text-[9px] font-semibold ${mg?.val}`}>{mg?.label}</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted/30 w-20 overflow-hidden">
                                    <div className={`h-full rounded-full ${mg?.bar}`} style={{ width: `${mosPct}%` }} />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/30 text-[11px]">—</span>
                              )}
                            </td>

                            {/* Jitter */}
                            <td className="px-3 py-3">
                              <div className="space-y-0.5">
                                <p className="font-mono text-[13px] text-muted-foreground/25">—</p>
                                <p className="text-[8px] text-muted-foreground/20">RTCP-XR</p>
                              </div>
                            </td>

                            {/* Packet Loss */}
                            <td className="px-3 py-3">
                              <div className="space-y-0.5">
                                <p className="font-mono text-[13px] text-muted-foreground/25">—</p>
                                <p className="text-[8px] text-muted-foreground/20">RTCP-XR</p>
                              </div>
                            </td>

                            {/* Vendor RTP IP */}
                            <td className="px-3 py-3">
                              {rtpIp ? (
                                <div className="space-y-1">
                                  <p className="font-mono text-[10px] text-cyan-400/80">{rtpIp}</p>
                                  <IpInfoBadge ip={rtpIp} color="blue" />
                                </div>
                              ) : (
                                <span className="text-muted-foreground/30 text-[11px]">—</span>
                              )}
                            </td>

                            {/* Issues */}
                            <td className="px-3 py-3">
                              {issues.length > 0 ? (
                                <div className="space-y-0.5">
                                  {issues.map((iss, j) => (
                                    <div key={j} className="flex items-center gap-1 text-[9px] text-amber-400 font-semibold">
                                      <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />
                                      {iss}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-[9px] text-emerald-400">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  Clean
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Footer legend */}
              <div className="px-4 py-3 border-t border-border/30 bg-muted/10 flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground/40">
                <div className="flex items-center gap-1.5">
                  <HeartPulse className="w-3 h-3 text-rose-400/50" />
                  <span>MOS estimated via ITU-T G.107 E-model (PDD-based). Scores may differ from RTCP-XR measurements.</span>
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Info className="w-3 h-3" />
                  <span>Jitter &amp; Packet Loss require RTCP-XR or dedicated RTP monitor.</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── CALL HISTORY TAB ─────────────────────────────────────────────── */}
      {callViewTab === 'history' && (() => {
        const rows = histData?.calls ?? [];

        function calcMOS(pddMs: number): number | null {
          if (pddMs <= 0) return null;
          const d = pddMs * 0.3;
          const R = Math.max(0, Math.min(100, 94.2 - 0.024 * d - 0.11 * (d > 177.3 ? d - 177.3 : 0)));
          return Math.max(1, Math.min(4.5, Math.round((1 + 0.035 * R + 7e-6 * R * (R - 60) * (100 - R)) * 10) / 10));
        }
        function mosColor(mos: number | null) {
          if (mos === null) return 'text-muted-foreground/30';
          if (mos >= 4.3) return 'text-emerald-400';
          if (mos >= 4.0) return 'text-green-400';
          if (mos >= 3.6) return 'text-amber-400';
          if (mos >= 3.1) return 'text-orange-400';
          return 'text-red-400';
        }
        function mosLabel(mos: number | null) {
          if (mos === null) return '—';
          if (mos >= 4.3) return 'Excellent';
          if (mos >= 4.0) return 'Good';
          if (mos >= 3.6) return 'Fair';
          if (mos >= 3.1) return 'Poor';
          return 'Bad';
        }
        function fmtTime(iso: string) {
          return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        }
        function fmtDate(iso: string) {
          return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
        }

        const mosList  = rows.map(r => calcMOS(r.pddMs ?? 0)).filter((v): v is number => v !== null);
        const avgMOS   = mosList.length > 0 ? Math.round((mosList.reduce((a,b) => a+b,0) / mosList.length) * 10) / 10 : null;
        const avgPDD   = rows.length > 0 ? Math.round(rows.reduce((s,r) => s + (r.pddMs ?? 0), 0) / rows.length) : 0;
        const uClients = new Set(rows.map(r => r.clientName).filter(Boolean)).size;
        const uVendors = new Set(rows.map(r => r.vendor).filter(Boolean)).size;

        return (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-violet-400" />
                  <span className="text-sm font-medium">Call History</span>
                  <span className="text-xs text-muted-foreground">— saved every 30 s, retained 24 h</span>
                </div>
                <div className="flex items-center gap-1.5 bg-muted/30 rounded-lg p-1 border border-border/50">
                  <button onClick={() => setRouteAnalysisMode(false)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${!routeAnalysisMode ? 'bg-card border border-border shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    data-testid="button-history-table-mode">
                    <span className="flex items-center gap-1.5"><List className="w-3 h-3" /> Call Log</span>
                  </button>
                  <button onClick={() => { setRouteAnalysisMode(true); refetchRQ(); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${routeAnalysisMode ? 'bg-violet-500/20 border border-violet-500/30 text-violet-400 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    data-testid="button-route-analysis-mode">
                    <span className="flex items-center gap-1.5"><TrendingUp className="w-3 h-3" /> Route Analysis</span>
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Show last:</span>
                {[1, 3, 6, 12, 24].map(h => (
                  <button key={h} onClick={() => setHistoryHours(h)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${historyHours === h ? 'bg-violet-500/10 text-violet-400 border-violet-500/30' : 'text-muted-foreground border-border/50 hover:border-border'}`}
                    data-testid={`button-history-${h}h`}>{h}h</button>
                ))}
                <button onClick={() => routeAnalysisMode ? refetchRQ() : refetchHist()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-card border border-border hover:bg-muted/40 transition-colors" data-testid="button-refresh-history">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5"><Phone className="w-3 h-3" /> Total Calls</p>
                <p className="text-2xl font-bold">{rows.length}</p>
                <p className="text-[10px] text-muted-foreground/40">in last {historyHours}h</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-emerald-400" /> Clients</p>
                <p className="text-2xl font-bold">{uClients}</p>
                <p className="text-[10px] text-muted-foreground/40">unique accounts</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5"><Network className="w-3 h-3 text-orange-400" /> Vendors</p>
                <p className="text-2xl font-bold">{uVendors}</p>
                <p className="text-[10px] text-muted-foreground/40">carriers seen</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5"><HeartPulse className="w-3 h-3 text-rose-400" /> Avg MOS</p>
                <p className={`text-2xl font-bold ${mosColor(avgMOS)}`}>{avgMOS?.toFixed(1) ?? '—'}</p>
                <p className={`text-[10px] font-medium ${mosColor(avgMOS)}`}>{mosLabel(avgMOS)} <span className="text-muted-foreground/30 font-normal">est.</span></p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5"><Timer className="w-3 h-3 text-cyan-400" /> Avg PDD</p>
                <p className={`text-2xl font-bold ${avgPDD >= 3000 ? 'text-red-400' : avgPDD >= 2000 ? 'text-orange-400' : avgPDD >= 1000 ? 'text-amber-400' : 'text-emerald-400'}`}>{avgPDD > 0 ? `${avgPDD} ms` : '—'}</p>
                <p className="text-[10px] text-muted-foreground/40">setup latency</p>
              </div>
            </div>

            {/* ── ROUTE ANALYSIS MODE ───────────────────────────────────────── */}
            {routeAnalysisMode && (() => {
              function calcMOS2(pddMs: number): number | null {
                if (pddMs <= 0) return null;
                const d = pddMs * 0.3;
                const R = Math.max(0, Math.min(100, 94.2 - 0.024 * d - 0.11 * (d > 177.3 ? d - 177.3 : 0)));
                return Math.max(1, Math.min(4.5, Math.round((1 + 0.035 * R + 7e-6 * R * (R - 60) * (100 - R)) * 10) / 10));
              }
              function gradeColor(mos: number | null) {
                if (!mos) return 'text-muted-foreground/30';
                if (mos >= 4.3) return 'text-emerald-400'; if (mos >= 4.0) return 'text-green-400';
                if (mos >= 3.6) return 'text-amber-400';   if (mos >= 3.1) return 'text-orange-400';
                return 'text-red-400';
              }
              function gradeLabel(mos: number | null) {
                if (!mos) return '—'; if (mos >= 4.3) return 'Excellent'; if (mos >= 4.0) return 'Good';
                if (mos >= 3.6) return 'Fair'; if (mos >= 3.1) return 'Poor'; return 'Bad';
              }
              function gradeBorder(mos: number | null) {
                if (!mos) return 'border-border'; if (mos >= 4.3) return 'border-emerald-500/40';
                if (mos >= 4.0) return 'border-green-500/40'; if (mos >= 3.6) return 'border-amber-500/40';
                if (mos >= 3.1) return 'border-orange-500/40'; return 'border-red-500/40';
              }
              function pddColor(pdd: number) {
                if (pdd === 0) return 'text-muted-foreground/30';
                if (pdd < 1000) return 'text-emerald-400'; if (pdd < 2000) return 'text-amber-400';
                if (pdd < 3000) return 'text-orange-400'; return 'text-red-400';
              }
              function fmtHour(iso: string) {
                try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
                catch { return iso.slice(11, 16); }
              }

              if (rqLoading) return (
                <div className="bg-card border border-border rounded-xl p-16 text-center">
                  <Loader2 className="w-7 h-7 animate-spin mx-auto mb-3 text-violet-400" />
                  <p className="text-muted-foreground text-sm">Analyzing {historyHours}h of route data…</p>
                </div>
              );
              const routes = rqData?.routes ?? [];
              if (!routes.length) return (
                <div className="bg-card border border-border rounded-xl p-16 text-center">
                  <BarChart2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
                  <p className="text-muted-foreground font-medium">No route data yet</p>
                  <p className="text-muted-foreground/50 text-sm mt-1">Call history is recorded every 30 s. Check back once calls are active.</p>
                </div>
              );

              // Build combined hourly chart data across all routes
              const allHours = Array.from(new Set(routes.flatMap(r => r.hourlyBuckets.map(b => b.hour)))).sort();
              const chartData = allHours.map(hour => {
                const point: Record<string, string | number> = { hour: fmtHour(hour) };
                for (const route of routes) {
                  const bucket = route.hourlyBuckets.find(b => b.hour === hour);
                  point[route.vendor + '_pdd']   = bucket?.avgPddMs  ?? 0;
                  point[route.vendor + '_calls']  = bucket?.callCount ?? 0;
                  point[route.vendor + '_good']   = bucket?.goodPct   ?? 0;
                }
                return point;
              });

              const ROUTE_COLORS = ['#a78bfa','#34d399','#fb923c','#60a5fa','#f472b6','#fbbf24'];

              return (
                <div className="space-y-4">
                  {/* Route Quality Cards */}
                  <div className={`grid gap-4 ${routes.length === 1 ? 'grid-cols-1' : routes.length === 2 ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                    {routes.map((route, i) => {
                      const mos = calcMOS2(route.avgPddMs);
                      const topCodec = Object.entries(route.codecs).sort((a,b) => b[1]-a[1])[0];
                      return (
                        <div key={route.vendor} className={`bg-card border ${gradeBorder(mos)} rounded-xl p-5 space-y-4`} data-testid={`card-route-${i}`}>
                          {/* Header */}
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ backgroundColor: ROUTE_COLORS[i % ROUTE_COLORS.length] }} />
                                <p className="font-semibold text-sm">{route.vendor}</p>
                              </div>
                              {route.connections.length > 0 && (
                                <p className="text-[10px] text-muted-foreground/40 mt-0.5 ml-4">Conn #{route.connections.join(', #')}</p>
                              )}
                            </div>
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                              !mos ? 'border-border text-muted-foreground' :
                              mos >= 4.0 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                              mos >= 3.6 ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                              mos >= 3.1 ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' :
                              'bg-red-500/10 border-red-500/30 text-red-400'
                            }`}>
                              {gradeLabel(mos)}
                            </span>
                          </div>

                          {/* Key Metrics */}
                          <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-0.5">
                              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1"><HeartPulse className="w-2.5 h-2.5" /> MOS (est.)</p>
                              <p className={`text-xl font-bold ${gradeColor(mos)}`}>{mos?.toFixed(1) ?? '—'}</p>
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1"><Timer className="w-2.5 h-2.5" /> Avg PDD</p>
                              <p className={`text-xl font-bold ${pddColor(route.avgPddMs)}`}>{route.avgPddMs > 0 ? `${route.avgPddMs}ms` : '—'}</p>
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1"><Phone className="w-2.5 h-2.5" /> Calls</p>
                              <p className="text-xl font-bold">{route.callCount}</p>
                            </div>
                          </div>

                          {/* Good/Bad bar */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px] text-muted-foreground/50">
                              <span className="flex items-center gap-1"><ThumbsUp className="w-2.5 h-2.5 text-emerald-400" />{route.goodCalls} good (&lt;2s PDD)</span>
                              <span className="flex items-center gap-1">{route.badCalls} bad (&ge;3s) <ThumbsDown className="w-2.5 h-2.5 text-red-400" /></span>
                            </div>
                            <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500/70 rounded-full transition-all" style={{ width: `${route.goodPct}%` }} />
                            </div>
                            <div className="flex justify-between text-[9px] text-muted-foreground/30">
                              <span>P95: {route.p95PddMs > 0 ? `${route.p95PddMs}ms` : '—'}</span>
                              <span>Max: {route.maxPddMs > 0 ? `${route.maxPddMs}ms` : '—'}</span>
                            </div>
                          </div>

                          {/* Codec + Clients */}
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
                            <span className="flex items-center gap-1"><Mic2 className="w-2.5 h-2.5" />
                              {topCodec ? topCodec[0] : 'No codec data'}
                            </span>
                            {route.clients.length > 0 && (
                              <span>{route.clients.slice(0,2).join(', ')}{route.clients.length > 2 ? ` +${route.clients.length-2}` : ''}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Hourly PDD Trend Chart */}
                  {chartData.length > 1 && (
                    <div className="bg-card border border-border rounded-xl p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <TrendingUp className="w-4 h-4 text-violet-400" />
                        <p className="text-sm font-medium">Hourly PDD Trend</p>
                        <span className="text-xs text-muted-foreground">— average setup latency per route per hour</span>
                      </div>
                      <div className="h-52">
                        <ResponsiveContainer width="100%" height={208}>
                          <LineChart data={chartData} margin={{ top: 6, right: 8, left: -8, bottom: 4 }}>
                            <CartesianGrid {...BSE_GRID_PROPS} />
                            <XAxis dataKey="hour" {...BSE_AXIS_PROPS} />
                            <YAxis {...BSE_AXIS_PROPS} unit="ms" />
                            <ReTooltip
                              content={<BseTooltip formatter={(val: number, key: string) => [`${val} ms`, key.replace('_pdd','')]} />}
                              cursor={BSE_CURSOR}
                            />
                            <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(148,163,184,0.7)' }} formatter={n => n.replace('_pdd','')} />
                            {routes.map((route, i) => (
                              <Line key={route.vendor} type="monotone" dataKey={`${route.vendor}_pdd`}
                                stroke={ROUTE_COLORS[i % ROUTE_COLORS.length]} strokeWidth={2}
                                dot={false} activeDot={bseActiveDot(ROUTE_COLORS[i % ROUTE_COLORS.length], 3)} name={route.vendor} strokeLinecap="round" />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Hourly Call Volume Chart */}
                  {chartData.length > 1 && (
                    <div className="bg-card border border-border rounded-xl p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <BarChart2 className="w-4 h-4 text-cyan-400" />
                        <p className="text-sm font-medium">Hourly Call Volume</p>
                        <span className="text-xs text-muted-foreground">— concurrent calls captured per hour per route</span>
                      </div>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height={176}>
                          <BarChart data={chartData} margin={{ top: 6, right: 8, left: -8, bottom: 4 }} barGap={2}>
                            <CartesianGrid {...BSE_GRID_PROPS} />
                            <XAxis dataKey="hour" {...BSE_AXIS_PROPS} />
                            <YAxis {...BSE_AXIS_PROPS} />
                            <ReTooltip content={<BseTooltip formatter={(v, k) => [v, k.replace('_calls','')]} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                            <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(148,163,184,0.7)' }} formatter={n => n.replace('_calls','')} />
                            {routes.map((route, i) => (
                              <Bar key={route.vendor} dataKey={`${route.vendor}_calls`}
                                fill={ROUTE_COLORS[i % ROUTE_COLORS.length]} fillOpacity={0.85}
                                radius={[3,3,0,0]} name={route.vendor} />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Summary Comparison Table */}
                  <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-border/50 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-muted-foreground/50" />
                      <p className="text-sm font-medium">Route Comparison</p>
                      <span className="text-xs text-muted-foreground">· last {historyHours}h · {rqData?.totalCalls ?? 0} calls total</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-muted/30 text-muted-foreground text-[10px] uppercase tracking-wider border-b border-border/50">
                          <tr>
                            <th className="px-4 py-2.5">Route / Vendor</th>
                            <th className="px-4 py-2.5 text-right">Calls</th>
                            <th className="px-4 py-2.5 text-right">MOS (est.)</th>
                            <th className="px-4 py-2.5 text-right">Avg PDD</th>
                            <th className="px-4 py-2.5 text-right">P95 PDD</th>
                            <th className="px-4 py-2.5 text-right">Good %</th>
                            <th className="px-4 py-2.5 text-right">Top Codec</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {routes.map((route, i) => {
                            const mos = calcMOS2(route.avgPddMs);
                            const topCodec = Object.entries(route.codecs).sort((a,b) => b[1]-a[1])[0];
                            return (
                              <tr key={route.vendor} className="hover:bg-muted/20 transition-colors" data-testid={`row-route-${i}`}>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ROUTE_COLORS[i % ROUTE_COLORS.length] }} />
                                    <span className="font-medium">{route.vendor}</span>
                                  </div>
                                  {route.connections.length > 0 && <p className="text-[10px] text-muted-foreground/40 ml-4">#{route.connections.join(', #')}</p>}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-[12px]">{route.callCount}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className={`font-bold text-[13px] ${gradeColor(mos)}`}>{mos?.toFixed(1) ?? '—'}</span>
                                  <span className={`ml-1 text-[10px] ${gradeColor(mos)}`}>{gradeLabel(mos)}</span>
                                </td>
                                <td className={`px-4 py-3 text-right font-mono text-[12px] font-semibold ${pddColor(route.avgPddMs)}`}>
                                  {route.avgPddMs > 0 ? `${route.avgPddMs} ms` : '—'}
                                </td>
                                <td className={`px-4 py-3 text-right font-mono text-[12px] ${pddColor(route.p95PddMs)}`}>
                                  {route.p95PddMs > 0 ? `${route.p95PddMs} ms` : '—'}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <span className={`text-[12px] font-semibold ${route.goodPct >= 80 ? 'text-emerald-400' : route.goodPct >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                                    {route.goodPct}%
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right text-[11px] text-muted-foreground/60 font-mono">
                                  {topCodec?.[0] ?? '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── CALL LOG TABLE (normal mode) ──────────────────────────────── */}
            {!routeAnalysisMode && (
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              {histLoading ? (
                <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />Loading call history…</div>
              ) : rows.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-14 h-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-3"><History className="w-7 h-7 text-muted-foreground/40" /></div>
                  <p className="text-muted-foreground font-medium">No call history yet</p>
                  <p className="text-sm text-muted-foreground/50 mt-1">Calls are captured every 30 s once active calls are detected.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/40 text-muted-foreground border-b border-border/50">
                      <tr>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">#</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">First Seen</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Last Seen</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Caller / Callee</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Client / Vendor</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Max Duration</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">SIP State</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">PDD</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">MOS (est.)</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">RTP IP</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">Codec</th>
                        <th className="px-3 py-3 font-medium text-[11px] uppercase tracking-wider">SIP Call-ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {rows.map((row, i) => {
                        const mos    = calcMOS(row.pddMs ?? 0);
                        const mosPct = mos !== null ? Math.round(((mos - 1) / 3.5) * 100) : 0;
                        const pddMs  = row.pddMs ?? 0;
                        const ccStyle = CC_STATE_STYLE[row.ccState ?? ''] ?? CC_STATE_STYLE['ARComplete'];
                        const rtpIp  = row.mediaIpCallee || row.mediaIpCaller;
                        return (
                          <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2.5 text-muted-foreground/40 text-[11px] font-mono">{i + 1}</td>
                            <td className="px-3 py-2.5">
                              <p className="text-[11px] font-mono text-foreground/70">{fmtTime(row.firstSeen)}</p>
                              <p className="text-[9px] text-muted-foreground/40">{fmtDate(row.firstSeen)}</p>
                            </td>
                            <td className="px-3 py-2.5">
                              <p className="text-[11px] font-mono text-foreground/70">{fmtTime(row.lastSeen)}</p>
                              <p className="text-[9px] text-muted-foreground/40">{fmtDate(row.lastSeen)}</p>
                            </td>
                            <td className="px-3 py-2.5">
                              <p className="font-mono text-[11px] text-foreground/80">{row.caller || '—'}</p>
                              <p className="font-mono text-[11px] text-muted-foreground/50">→ {row.callee || '—'}</p>
                            </td>
                            <td className="px-3 py-2.5">
                              <p className="text-[11px] font-medium text-foreground/80">{row.clientName || '—'}</p>
                              <p className="text-[11px] text-muted-foreground/50">{row.vendor || '—'}</p>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[12px] text-foreground/70">
                              {formatDuration(Math.floor(row.maxDurationSecs ?? 0))}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ccStyle.badge}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${ccStyle.dot.replace(' animate-pulse','')}`} />
                                {ccStyle.label}
                              </span>
                              {row.direction && <p className="text-[9px] text-muted-foreground/30 mt-0.5 capitalize">{row.direction.replace(/_/g,' ')}</p>}
                            </td>
                            <td className="px-3 py-2.5">
                              <p className={`font-mono text-[12px] font-semibold ${pddMs >= 3000 ? 'text-red-400' : pddMs >= 2000 ? 'text-orange-400' : pddMs >= 1000 ? 'text-amber-400' : pddMs > 0 ? 'text-emerald-400' : 'text-muted-foreground/30'}`}>
                                {pddMs > 0 ? `${pddMs} ms` : '—'}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 min-w-[110px]">
                              {mos !== null ? (
                                <div className="space-y-1">
                                  <div className="flex items-baseline gap-1.5">
                                    <p className={`font-mono text-[13px] font-bold ${mosColor(mos)}`}>{mos.toFixed(1)}</p>
                                    <span className={`text-[9px] font-semibold ${mosColor(mos)}`}>{mosLabel(mos)}</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted/30 w-16 overflow-hidden">
                                    <div className={`h-full rounded-full ${mos >= 4.0 ? 'bg-emerald-400' : mos >= 3.6 ? 'bg-amber-400' : mos >= 3.1 ? 'bg-orange-400' : 'bg-red-400'}`} style={{ width: `${mosPct}%` }} />
                                  </div>
                                </div>
                              ) : <span className="text-muted-foreground/30 text-[11px]">—</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              {rtpIp ? (
                                <div className="space-y-0.5">
                                  <p className="font-mono text-[10px] text-cyan-400/80">{rtpIp}</p>
                                  <IpInfoBadge ip={rtpIp} color="blue" />
                                </div>
                              ) : <span className="text-muted-foreground/30 text-[11px]">—</span>}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-foreground/60">{row.codec || '—'}</td>
                            <td className="px-3 py-2.5">
                              <p className="font-mono text-[9px] text-muted-foreground/40 max-w-[160px] truncate" title={row.sippyCallId}>{row.sippyCallId}</p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="px-4 py-3 border-t border-border/30 bg-muted/10 flex items-center justify-between text-[10px] text-muted-foreground/40">
                <div className="flex items-center gap-1.5">
                  <History className="w-3 h-3 text-violet-400/50" />
                  <span>{rows.length} call{rows.length !== 1 ? 's' : ''} in the last {historyHours}h · polled every 30 s · auto-expires after 24 h</span>
                </div>
                <span>MOS estimated via ITU-T G.107 E-model</span>
              </div>
            </div>
            )}

          </div>
        );
      })()}

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
