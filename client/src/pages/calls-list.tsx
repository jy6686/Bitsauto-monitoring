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
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const qc = useQueryClient();

  const isPrimary = switchId === 'primary';

  // Primary switch: use portal endpoints
  const { data: primarySession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
    enabled: isPrimary,
  });
  const { data: primaryLiveCalls, isLoading: primaryLoading, refetch: refetchPrimary } = useQuery<{ calls: LiveCall[]; error?: string }>({
    queryKey: ['/api/portal/live-calls'],
    refetchInterval: 15000,
    enabled: isPrimary && !!primarySession?.active,
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
  const isActive = isPrimary
    ? !!primarySession?.active
    : (switchType === 'sippy' ? true : !!switchSession?.active);
  const isLoading = isPrimary ? primaryLoading : switchLoading;
  const needsLogin = !isPrimary && switchType === 'vos3000' && !switchSession?.active;
  const liveCallData = isPrimary ? primaryLiveCalls : switchLiveCalls;

  // Build live calls list
  const liveCalls: LiveCall[] = liveCallData?.calls ?? (
    isPrimary && !primarySession?.active
      ? (calls ?? []).filter((c: any) => c.status === 'active').map((c: any) => ({
          id: String(c.id),
          caller: c.caller,
          callee: c.callee,
          gateway: '',
          duration: 0,
          callStatus: 'connected' as const,
        }))
      : []
  );

  const summaryRows = buildSummary(liveCalls);
  const totalConnected = summaryRows.reduce((s, r) => s + r.connected, 0);
  const totalRouting = summaryRows.reduce((s, r) => s + r.routing, 0);
  const totalCalls = summaryRows.reduce((s, r) => s + r.total, 0);

  const filteredCalls = calls?.filter((call: any) =>
    call.caller.includes(search) || call.callee.includes(search)
  );

  const handleRefresh = () => isPrimary ? refetchPrimary() : refetchSwitch();

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
          ) : (
            // Secondary switch: show live call records
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/40 text-muted-foreground border-b border-border/50">
                  <tr>
                    <th className="px-6 py-4 font-medium">Caller</th>
                    <th className="px-6 py-4 font-medium">Destination</th>
                    <th className="px-6 py-4 font-medium text-center">Duration</th>
                    <th className="px-6 py-4 font-medium text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {liveCalls.filter(c => !search || c.caller.includes(search) || c.callee.includes(search)).map((call, i) => {
                    const callerCountry = lookupCountry(call.caller);
                    const calleeCountry = lookupCountry(call.callee);
                    return (
                      <tr key={call.id || i} className="hover:bg-muted/20 transition-colors" data-testid={`row-live-${i}`}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                              <Phone className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="font-mono text-sm">{call.caller}</span>
                              {callerCountry && <p className="text-xs text-muted-foreground mt-0.5">{callerCountry.flag} {callerCountry.name}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-sm">{call.callee}</span>
                          {calleeCountry && <p className="text-xs text-muted-foreground mt-0.5">{calleeCountry.flag} {calleeCountry.name}</p>}
                        </td>
                        <td className="px-6 py-4 text-center text-muted-foreground font-mono">
                          {formatDuration(call.duration)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            call.callStatus === 'connected'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${call.callStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                            {call.callStatus === 'connected' ? 'Connected' : 'Routing'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {liveCalls.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                        {needsLogin ? 'Connect to this switch to see live calls.' : 'No active calls right now.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
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

  const { data: primarySession } = useQuery<{ active: boolean }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
  });

  const enabledSwitches = switches.filter(sw => sw.enabled !== false);

  // Derive current switch info
  const currentSwitchInfo = selectedSwitch === 'primary'
    ? { name: 'Primary', type: 'vos3000', active: !!primarySession?.active }
    : enabledSwitches.find(sw => sw.id === selectedSwitch);

  const currentName = selectedSwitch === 'primary' ? 'Primary VOS3000' : (currentSwitchInfo as SwitchRecord)?.name ?? 'Switch';
  const currentType = selectedSwitch === 'primary' ? 'vos3000' : (currentSwitchInfo as SwitchRecord)?.type ?? 'vos3000';

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
          <span>Primary VOS3000</span>
          {primarySession?.active ? (
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
