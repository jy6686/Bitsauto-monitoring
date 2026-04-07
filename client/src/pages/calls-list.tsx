import { useCalls } from "@/hooks/use-calls";
import { MosBadge } from "@/components/mos-badge";
import { Link } from "wouter";
import {
  Phone, Clock, Search, BarChart3, List, RefreshCw, CheckCircle2,
  ArrowRightLeft, Globe, Wifi, WifiOff, Server, Loader2, X, AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useState, useRef } from "react";
import { lookupCountry } from "@/lib/country-lookup";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveCall {
  id: string;
  caller: string;        // CLI (calling number)
  callee: string;        // CLD (destination number)
  gateway: string;
  clientName?: string;   // Account / customer name
  duration: number;
  callStatus: 'connected' | 'routing';
  // Sippy-specific fields
  vendor?: string;
  connection?: string;
  direction?: string;
  mediaIpCaller?: string;
  mediaIpCallee?: string;
  delay?: number;
  codec?: string;
  state?: string;
}

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

interface CaptchaChallenge {
  challengeId: string;
  imageBase64: string;
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

// ─── Captcha Modal ────────────────────────────────────────────────────────────

function CaptchaModal({
  switchId,
  switchName,
  onClose,
  onSuccess,
}: {
  switchId: number;
  switchName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const { data: captcha, isLoading: captchaLoading } = useQuery<CaptchaChallenge>({
    queryKey: ['/api/switches', switchId, 'captcha'],
    queryFn: () => fetch(`/api/switches/${switchId}/captcha`).then(r => r.json()),
  });

  const loginMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/switches/${switchId}/login`, {
      challengeId: captcha?.challengeId,
      captchaCode: code,
    }),
    onSuccess: async (data: any) => {
      if (data.success) {
        await qc.invalidateQueries({ queryKey: ['/api/switches', switchId, 'session'] });
        onSuccess();
        onClose();
      } else {
        setError(data.message || 'Login failed. Check CAPTCHA code.');
        setCode('');
      }
    },
    onError: () => setError('Connection error. Try again.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-lg">Connect to Switch</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{switchName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/40 transition-colors" data-testid="button-close-captcha">
            <X className="w-4 h-4" />
          </button>
        </div>

        {captchaLoading ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : captcha ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">Enter the code shown below:</p>
              <div className="rounded-lg overflow-hidden border border-border bg-white flex items-center justify-center p-2">
                <img
                  src={`data:image/jpeg;base64,${captcha.imageBase64}`}
                  alt="CAPTCHA"
                  className="h-14 object-contain"
                  data-testid="img-captcha"
                />
              </div>
            </div>
            <input
              type="text"
              placeholder="Type CAPTCHA code..."
              value={code}
              onChange={e => { setCode(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && loginMutation.mutate()}
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-mono tracking-widest"
              data-testid="input-captcha-code"
              autoFocus
            />
            {error && (
              <div className="flex items-center gap-2 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}
            <button
              onClick={() => loginMutation.mutate()}
              disabled={!code || loginMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-captcha-submit"
            >
              {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              {loginMutation.isPending ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        ) : (
          <div className="text-sm text-rose-400 text-center py-4">Failed to load CAPTCHA. Check switch URL in Settings.</div>
        )}
      </div>
    </div>
  );
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
  const { data: calls } = useCalls(200);
  const [callViewTab, setCallViewTab] = useState<'summary' | 'details'>('summary');
  const [search, setSearch] = useState('');
  const [filterCli, setFilterCli] = useState('');
  const [filterCld, setFilterCld] = useState('');
  const [filterState, setFilterState] = useState('all');
  const [filterVendor, setFilterVendor] = useState('all');
  const [filterConnection, setFilterConnection] = useState('all');
  const [showLatestFirst, setShowLatestFirst] = useState(false);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const qc = useQueryClient();

  const isPrimary = switchId === 'primary';
  const isPrimarySippy = isPrimary && switchType === 'sippy';
  const isPrimaryVos  = isPrimary && switchType !== 'sippy';

  // Primary Sippy: use /api/sippy/session + /api/sippy/live-calls
  const { data: primarySippySession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
    enabled: isPrimarySippy,
  });
  const { data: primarySippyLiveCalls, isLoading: sippyLoading, refetch: refetchSippy } = useQuery<{ calls: LiveCall[] }>({
    queryKey: ['/api/sippy/live-calls'],
    refetchInterval: 15000,
    enabled: isPrimarySippy && !!primarySippySession?.active,
  });

  // Primary VOS3000: use /api/portal/session + /api/portal/live-calls
  const { data: primaryVosSession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
    enabled: isPrimaryVos,
  });
  const { data: primaryVosLiveCalls, isLoading: vosLoading, refetch: refetchVos } = useQuery<{ calls: LiveCall[]; error?: string }>({
    queryKey: ['/api/portal/live-calls'],
    refetchInterval: 15000,
    enabled: isPrimaryVos && !!primaryVosSession?.active,
  });

  // Secondary switch: use per-switch endpoints
  const { data: switchSession } = useQuery<{ active: boolean; needsLogin?: boolean; note?: string }>({
    queryKey: ['/api/switches', switchId, 'session'],
    refetchInterval: 30000,
    enabled: !isPrimary,
    queryFn: () => fetch(`/api/switches/${switchId}/session`).then(r => r.json()),
  });
  const { data: switchLiveCalls, isLoading: switchLoading, refetch: refetchSwitch } = useQuery<{ calls: LiveCall[]; error?: string; needsLogin?: boolean }>({
    queryKey: ['/api/switches', switchId, 'live-calls'],
    refetchInterval: 15000,
    enabled: !isPrimary,
    queryFn: () => fetch(`/api/switches/${switchId}/live-calls`).then(r => r.json()),
  });

  // Resolve active state
  const isActive = isPrimarySippy
    ? !!primarySippySession?.active
    : isPrimaryVos
    ? !!primaryVosSession?.active
    : (switchType === 'sippy' ? true : !!switchSession?.active);

  const isLoading = isPrimarySippy ? sippyLoading : isPrimaryVos ? vosLoading : switchLoading;
  const needsLogin = isPrimaryVos
    ? !primaryVosSession?.active
    : !isPrimary && switchType === 'vos3000' && !switchSession?.active;

  const handleRefresh = () =>
    isPrimarySippy ? refetchSippy() : isPrimaryVos ? refetchVos() : refetchSwitch();

  const liveCallData = isPrimarySippy
    ? primarySippyLiveCalls
    : isPrimaryVos
    ? primaryVosLiveCalls
    : switchLiveCalls;

  // Build live calls list
  const liveCalls: LiveCall[] = liveCallData?.calls ?? [];

  const summaryRows = buildSummary(liveCalls);
  const totalConnected = summaryRows.reduce((s, r) => s + r.connected, 0);
  const totalRouting = summaryRows.reduce((s, r) => s + r.routing, 0);
  const totalCalls = summaryRows.reduce((s, r) => s + r.total, 0);

  const filteredCalls = calls?.filter((call: any) =>
    call.caller.includes(search) || call.callee.includes(search)
  );

  return (
    <div className="space-y-4">
      {/* Connection banner */}
      {needsLogin && (
        <div className="flex items-center justify-between gap-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
          <div className="flex items-center gap-3">
            <WifiOff className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-300">Not connected to {switchName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Login with CAPTCHA to see live calls from this VOS3000 switch.</p>
            </div>
          </div>
          <button
            onClick={() => setCaptchaOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm font-medium hover:bg-amber-500/20 transition-colors flex-shrink-0"
            data-testid={`button-connect-switch-${switchId}`}
          >
            <Wifi className="w-4 h-4" />
            Connect
          </button>
        </div>
      )}

      {liveCallData?.error && !needsLogin && (
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
          {isPrimary ? (
            // Primary: show DB call records
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
                        <td className="px-6 py-4"><MosBadge value={call.latestMetric?.mos || 0} /></td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            call.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                              : call.status === 'failed'
                              ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                              : 'bg-muted text-muted-foreground border border-border/50'
                          }`}>
                            {call.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                            {call.status.charAt(0).toUpperCase() + call.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link href={`/calls/${call.id}`} className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium bg-secondary hover:bg-secondary/80 transition-colors" data-testid={`link-inspect-${call.id}`}>
                            Inspect
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCalls?.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No calls found matching your search.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (() => {
            // Build unique vendor/connection lists for dropdowns
            const vendors = Array.from(new Set(liveCalls.map(c => c.vendor).filter(Boolean))) as string[];
            const connections = Array.from(new Set(liveCalls.map(c => c.connection).filter(Boolean))) as string[];

            // Apply filters
            let displayed = liveCalls.filter(c => {
              if (filterCli && !c.caller.toLowerCase().includes(filterCli.toLowerCase())) return false;
              if (filterCld && !c.callee.toLowerCase().includes(filterCld.toLowerCase())) return false;
              if (filterState !== 'all' && c.callStatus !== filterState) return false;
              if (filterVendor !== 'all' && c.vendor !== filterVendor) return false;
              if (filterConnection !== 'all' && c.connection !== filterConnection) return false;
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
                        onClick={() => { setFilterCli(''); setFilterCld(''); setFilterState('all'); setFilterVendor('all'); setFilterConnection('all'); setShowLatestFirst(false); }}
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
                        <th className="px-3 py-3 font-medium w-10 text-center">#</th>
                        <th className="px-4 py-3 font-medium">Caller</th>
                        <th className="px-4 py-3 font-medium">CLI</th>
                        <th className="px-4 py-3 font-medium">CLD</th>
                        <th className="px-4 py-3 font-medium">State</th>
                        <th className="px-4 py-3 font-medium">Vendor</th>
                        <th className="px-4 py-3 font-medium">Connection</th>
                        <th className="px-4 py-3 font-medium">Direction</th>
                        <th className="px-4 py-3 font-medium text-center" colSpan={2}>Media IP</th>
                        <th className="px-4 py-3 font-medium text-right">Delay</th>
                        <th className="px-4 py-3 font-medium text-right">Duration</th>
                      </tr>
                      <tr className="border-b border-border/30">
                        <th />
                        <th />
                        <th />
                        <th />
                        <th />
                        <th />
                        <th />
                        <th />
                        <th className="px-4 py-1.5 text-center text-muted-foreground/60 font-normal text-xs">Caller</th>
                        <th className="px-4 py-1.5 text-center text-muted-foreground/60 font-normal text-xs">Callee</th>
                        <th />
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {displayed.map((call, i) => (
                        <tr key={call.id || i} className="hover:bg-muted/20 transition-colors text-xs" data-testid={`row-live-${i}`}>
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
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                              call.callStatus === 'connected'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${call.callStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                              {call.callStatus === 'connected' ? 'Connected' : 'Routing'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-vendor-${i}`}>{call.vendor || <span className="text-muted-foreground/30">—</span>}</td>
                          <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-connection-${i}`}>{call.connection || <span className="text-muted-foreground/30">—</span>}</td>
                          <td className="px-4 py-3 text-muted-foreground" data-testid={`cell-direction-${i}`}>{call.direction || <span className="text-muted-foreground/30">—</span>}</td>
                          <td className="px-4 py-3 font-mono text-muted-foreground text-center" data-testid={`cell-media-caller-${i}`}>{call.mediaIpCaller || <span className="text-muted-foreground/30">—</span>}</td>
                          <td className="px-4 py-3 font-mono text-muted-foreground text-center" data-testid={`cell-media-callee-${i}`}>{call.mediaIpCallee || <span className="text-muted-foreground/30">—</span>}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground font-mono" data-testid={`cell-delay-${i}`}>
                            {call.delay != null ? `${call.delay}ms` : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-foreground/70" data-testid={`cell-duration-${i}`}>
                            {formatDuration(call.duration)}
                          </td>
                        </tr>
                      ))}
                      {displayed.length === 0 && (
                        <tr>
                          <td colSpan={12} className="px-6 py-12 text-center text-muted-foreground">
                            {needsLogin ? 'Connect to this switch to see live calls.' : 'No active calls match the current filters.'}
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

      {/* CAPTCHA modal */}
      {captchaOpen && typeof switchId === 'number' && (
        <CaptchaModal
          switchId={switchId}
          switchName={switchName}
          onClose={() => setCaptchaOpen(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['/api/switches', switchId, 'live-calls'] });
          }}
        />
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

  // Load settings to know the primary switch type (sippy vs vos3000)
  const { data: settings } = useQuery<{ switchType?: string }>({
    queryKey: ['/api/settings'],
    refetchInterval: 60000,
    select: d => ({ switchType: (d as any).switchType }),
  });
  const primarySwitchType: string = settings?.switchType ?? 'vos3000';
  const primaryLabel = primarySwitchType === 'sippy' ? 'Primary Sippy' : 'Primary VOS3000';

  // Primary session: Sippy uses /api/sippy/session; VOS3000 uses /api/portal/session
  const { data: primarySippySession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
    enabled: primarySwitchType === 'sippy',
  });
  const { data: primaryVosSession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
    enabled: primarySwitchType !== 'sippy',
  });
  const primarySessionActive = primarySwitchType === 'sippy'
    ? !!primarySippySession?.active
    : !!primaryVosSession?.active;

  const enabledSwitches = switches.filter(sw => sw.enabled !== false);

  const currentSwitchInfo = selectedSwitch === 'primary'
    ? { name: 'Primary', type: primarySwitchType, active: primarySessionActive }
    : enabledSwitches.find(sw => sw.id === selectedSwitch);

  const currentName = selectedSwitch === 'primary' ? primaryLabel : (currentSwitchInfo as SwitchRecord)?.name ?? 'Switch';
  const currentType = selectedSwitch === 'primary' ? primarySwitchType : (currentSwitchInfo as SwitchRecord)?.type ?? 'vos3000';

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
            {primarySwitchType === 'sippy' ? 'Sippy' : 'VOS3000'}
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

  const isLive = sw.type === 'sippy' ? true : !!session?.active;

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
        {sw.type === 'sippy' ? 'Sippy' : 'VOS3000'}
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
