import { useSettings, useUpdateSettings, useResetSimulation } from "@/hooks/use-settings";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSettingsSchema } from "@shared/schema";
import { z } from "zod";
import { useState, useEffect, useRef } from "react";
import {
  Loader2, Save, RefreshCw, Eye, EyeOff, Globe, CheckCircle2,
  XCircle, ExternalLink, LogIn, LogOut, ShieldCheck, RefreshCcw,
  Plus, Trash2, Pencil, Server, ChevronDown, ChevronUp, Users, UserPlus, X, AlertCircle,
  Radio, Activity, Mail, Bell, Send, MailCheck, MailX,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const formSchema = insertSettingsSchema.pick({
  jitterThreshold: true,
  latencyThreshold: true,
  packetLossThreshold: true,
  simulationEnabled: true,
  monitoredIp: true,
  switchType: true,
  portalUrl: true,
  portalUsername: true,
  portalPassword: true,
  apiAdminUsername: true,
  apiAdminPassword: true,
  snmpEnabled: true,
  snmpHost: true,
  snmpPort: true,
  snmpCommunity: true,
  snmpEnvironments: true,
});

type FormValues = z.infer<typeof formSchema>;
type TestResult = { ok: boolean; message: string } | null;

// ── Switch type definitions ───────────────────────────────────────────────────
const SWITCH_TYPES = [
  {
    id: 'sippy',
    label: 'Sippy Softswitch',
    description: 'Sippy Software softswitch (XML-RPC API with Digest Auth)',
    color: 'violet',
  },
] as const;

function useSippySession() {
  return useQuery<{ active: boolean; username?: string; connectedAt?: string; portalBase?: string; mode?: 'xmlrpc' | 'portal' }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
  });
}


// ── Sippy Connect Panel ────────────────────────────────────────────────────────
function SippyConnectPanel({ username, password }: { username: string; password: string }) {
  const qc = useQueryClient();
  const { data: session, isLoading: sessionLoading } = useSippySession();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const autoConnected = useRef(false);

  async function handleConnect() {
    setConnecting(true);
    setResult(null);
    try {
      const resp = await fetch('/api/sippy/connect', { method: 'POST' });
      const data = await resp.json();
      setResult({ ok: data.success, message: data.message });
      if (data.success) qc.invalidateQueries({ queryKey: ['/api/sippy/session'] });
    } catch {
      setResult({ ok: false, message: 'Network error — could not reach the server.' });
    } finally {
      setConnecting(false);
    }
  }

  // Auto-connect on mount when credentials are present and session is not active
  useEffect(() => {
    if (!sessionLoading && !session?.active && !autoConnected.current && username) {
      autoConnected.current = true;
      handleConnect();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, session?.active]);


  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch('/api/sippy/session', { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['/api/sippy/session'] });
      setResult(null);
    } finally {
      setDisconnecting(false);
    }
  }

  if (sessionLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking session…
      </div>
    );
  }

  if (session?.active) {
    const isXmlRpc = session.mode === 'xmlrpc';
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-emerald-400">Connected to Sippy Softswitch</p>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${isXmlRpc ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'}`}>
                  {isXmlRpc ? 'XML-RPC' : 'Portal'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Logged in as <span className="font-mono">{session.username}</span>
                {session.connectedAt && (
                  <> · since {new Date(session.connectedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false })}</>
                )}
              </p>
              {!isXmlRpc && (
                <p className="text-xs text-amber-400/80 mt-1">
                  Portal mode — monitoring charts require XML-RPC. Ensure admin credentials are saved above.
                </p>
              )}
            </div>
          </div>
          <button
            data-testid="button-sippy-disconnect"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-rose-400 hover:border-rose-400/50 transition-colors disabled:opacity-50"
          >
            {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
            Disconnect
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {isXmlRpc
            ? 'Full API access active — all features including monitoring charts are available.'
            : 'Live call data and CDR records are available. Save admin API credentials and reconnect for full monitoring access.'}
        </p>
      </div>
    );
  }

  const isAuthError = result && !result.ok && result.message.toLowerCase().includes('authentication failed');

  return (
    <div className="space-y-4">
      {result && (
        <div className={`text-sm px-3 py-2.5 rounded-lg border space-y-1 ${result.ok ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-400 border-rose-500/30 bg-rose-500/10'}`}>
          <div className="flex items-start gap-2">
            {result.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
            <span data-testid="text-sippy-connect-result">{result.message}</span>
          </div>
          {isAuthError && (
            <p className="text-xs text-rose-300/80 pl-6">
              Open{' '}
              <a href="https://191.101.30.107/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                your Sippy portal
              </a>
              {' '}→ click your username (top-right) → <strong>My Account</strong> → <strong>API Credentials</strong> to get the correct API Login and Password.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-4 space-y-1.5">
        <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Auto-Detect Mode</p>
        <p className="text-xs text-muted-foreground">
          Both credential pairs are tried automatically. If your admin account supports it, <strong>XML-RPC mode</strong> is used for full API access (monitoring charts, etc.). Otherwise <strong>Portal mode</strong> is used.
        </p>
        <p className="text-xs text-muted-foreground">
          The session stays active until you disconnect or the server restarts.
        </p>
      </div>

      <button
        type="button"
        data-testid="button-sippy-connect"
        onClick={handleConnect}
        disabled={connecting}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-colors disabled:opacity-50"
      >
        {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
        {connecting ? 'Connecting…' : 'Connect to Sippy'}
      </button>
    </div>
  );
}

// ── Sippy Users Panel ─────────────────────────────────────────────────────────

interface SippyPortalUser {
  userId: string;
  name: string;
  login: string;
  accessLevel: string;
  description?: string;
  email?: string;
  timezone?: string;
  language?: string;
  allowedHosts?: string;
  startPage?: string;
}

const EMPTY_USER_FORM = {
  name: '',
  login: '',
  password: '',
  accessLevel: 'Administrator',
  description: '',
  email: '',
  timezone: 'Etc/UTC',
  language: 'English',
  allowedHosts: '',
  startPage: 'Monitoring',
};

const ACCESS_LEVELS = ['Administrator', 'Billing', 'Support', 'Read-Only', 'Custom'];
const TIMEZONES = ['Etc/UTC', 'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London', 'Europe/Berlin', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
const START_PAGES = ['Monitoring', 'Dashboard', 'Customers', 'Accounts', 'CDRs', 'Reports'];
const LANGUAGES = ['English', 'French', 'German', 'Spanish', 'Arabic', 'Russian', 'Chinese'];

// ── Email Alert Configuration Panel ──────────────────────────────────────────

type AlertConfig = {
  alertEnabled: boolean;
  alertAdminEmail: string;
  alertGmailUser: string;
  alertGmailAppPass: string;
  balanceAlertThreshold: number;
  fasMinPddSecs: number;
  fasMaxBillSecs: number;
  fasEarlyAnswerSecs: number;
  fasShortCallSecs: number;
};

function EmailAlertPanel() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const { data: config, isLoading } = useQuery<AlertConfig>({
    queryKey: ['/api/alert-config'],
  });

  const [form, setForm] = useState<AlertConfig>({
    alertEnabled: false,
    alertAdminEmail: '',
    alertGmailUser: '',
    alertGmailAppPass: '',
    balanceAlertThreshold: 10,
    fasMinPddSecs: 10,
    fasMaxBillSecs: 5,
    fasEarlyAnswerSecs: 2,
    fasShortCallSecs: 10,
  });

  useEffect(() => {
    if (config) setForm({ ...config });
  }, [config]);

  const saveMut = useMutation({
    mutationFn: () => apiRequest('PATCH', '/api/alert-config', form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/alert-config'] }),
  });

  const testMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/alert-config/test', {});
      const json = await res.json();
      setTestResult(json);
      return json;
    },
  });

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 p-6 text-left hover:bg-muted/20 transition-colors"
      >
        <Mail className="h-5 w-5 text-violet-400 flex-shrink-0" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">Email Alert Configuration</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Gmail alerts for balance changes, FAS detection, wrong numbers &amp; auth events</p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-5 border-t border-border/50">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : (
            <>
              {/* Enable toggle */}
              <div className="flex items-center justify-between pt-4">
                <div>
                  <label className="text-sm font-medium">Enable Email Alerts</label>
                  <p className="text-xs text-muted-foreground mt-0.5">Send automated alerts via Gmail when events are detected</p>
                </div>
                <input
                  type="checkbox"
                  data-testid="input-alert-enabled"
                  checked={form.alertEnabled}
                  onChange={e => setForm(f => ({ ...f, alertEnabled: e.target.checked }))}
                  className="h-5 w-5 rounded border-border"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Admin email */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Admin Alert Email</label>
                  <p className="text-xs text-muted-foreground">Always receives all alerts</p>
                  <input
                    type="email"
                    data-testid="input-admin-email"
                    value={form.alertAdminEmail}
                    onChange={e => setForm(f => ({ ...f, alertAdminEmail: e.target.value }))}
                    placeholder="admin@company.com"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                {/* Gmail user */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Gmail Address (Sender)</label>
                  <p className="text-xs text-muted-foreground">The Gmail account that sends alerts</p>
                  <input
                    type="email"
                    data-testid="input-gmail-user"
                    value={form.alertGmailUser}
                    onChange={e => setForm(f => ({ ...f, alertGmailUser: e.target.value }))}
                    placeholder="voipmonitor@gmail.com"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              {/* Gmail App Password */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Gmail App Password</label>
                <p className="text-xs text-muted-foreground">
                  Generate at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-primary underline">myaccount.google.com/apppasswords</a>. 
                  16-character password, spaces optional.
                </p>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    data-testid="input-gmail-app-pass"
                    value={form.alertGmailAppPass}
                    onChange={e => setForm(f => ({ ...f, alertGmailAppPass: e.target.value }))}
                    placeholder="xxxx xxxx xxxx xxxx"
                    className="w-full px-3 py-2 pr-10 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                  />
                  <button type="button" onClick={() => setShowPass(s => !s)} className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground">
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Thresholds */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Balance Alert Threshold ($)</label>
                  <p className="text-xs text-muted-foreground">Alert when balance drops below this</p>
                  <input
                    type="number"
                    data-testid="input-balance-threshold"
                    value={form.balanceAlertThreshold}
                    onChange={e => setForm(f => ({ ...f, balanceAlertThreshold: Number(e.target.value) }))}
                    min={0} step={1}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">FAS Min PDD (seconds)</label>
                  <p className="text-xs text-muted-foreground">PDD above this = FAS suspect</p>
                  <input
                    type="number"
                    data-testid="input-fas-pdd"
                    value={form.fasMinPddSecs}
                    onChange={e => setForm(f => ({ ...f, fasMinPddSecs: Number(e.target.value) }))}
                    min={1} step={1}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">FAS Max Billed (seconds)</label>
                  <p className="text-xs text-muted-foreground">Billed under this despite answer = FAS</p>
                  <input
                    type="number"
                    data-testid="input-fas-bill"
                    value={form.fasMaxBillSecs}
                    onChange={e => setForm(f => ({ ...f, fasMaxBillSecs: Number(e.target.value) }))}
                    min={1} step={1}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Early Answer Max PDD (seconds)</label>
                  <p className="text-xs text-muted-foreground">PDD below this = suspiciously instant answer (pre-billing)</p>
                  <input
                    type="number"
                    data-testid="input-fas-early-answer"
                    value={form.fasEarlyAnswerSecs}
                    onChange={e => setForm(f => ({ ...f, fasEarlyAnswerSecs: Number(e.target.value) }))}
                    min={0} step={1}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Short Call Max Billed (seconds)</label>
                  <p className="text-xs text-muted-foreground">Answered calls billed under this are flagged as short-call pattern</p>
                  <input
                    type="number"
                    data-testid="input-fas-short-call"
                    value={form.fasShortCallSecs}
                    onChange={e => setForm(f => ({ ...f, fasShortCallSecs: Number(e.target.value) }))}
                    min={1} step={1}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  data-testid="button-save-alert-config"
                  onClick={() => saveMut.mutate()}
                  disabled={saveMut.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Alert Config
                </button>
                <button
                  type="button"
                  data-testid="button-test-email"
                  onClick={() => { setTestResult(null); testMut.mutate(); }}
                  disabled={testMut.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-muted/70 border border-border disabled:opacity-50"
                >
                  {testMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Test Connection
                </button>
                {saveMut.isSuccess && (
                  <span className="text-sm text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult.ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  {testResult.ok ? <MailCheck className="h-4 w-4" /> : <MailX className="h-4 w-4" />}
                  {testResult.ok ? 'Gmail connection verified successfully' : `Connection failed: ${testResult.error}`}
                </div>
              )}

              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground/70">Alert types:</p>
                <p>• Balance below threshold • Credit limit change • Auth rule add/delete</p>
                <p>• FAS (False Answer Supervision) detected • Wrong/switched-off number repeated</p>
                <p className="mt-1">Per-client alert emails can be set in the Clients &amp; Vendors section.</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sippy Change Watcher Panel ────────────────────────────────────────────────

interface WatcherStatus {
  initialized: boolean;
  lastRunAt: string | null;
  lastRunChanges: number | null;
  lastRunError: string | null;
  snapshot: {
    capturedAt: string;
    accounts: number;
    vendors: number;
    connections: number;
    authRules: number;
    seenClients: number;
    accountNames: string[];
    vendorNames: string[];
  } | null;
}

function SippyWatcherPanel() {
  const [expanded, setExpanded] = useState(true);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const { data: status, isLoading, refetch } = useQuery<WatcherStatus>({
    queryKey: ['/api/sippy-watcher/status'],
    refetchInterval: 30_000,
  });

  const testMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/sippy-watcher/test-alert', {});
      const json = await res.json();
      setTestResult(json);
      return json;
    },
  });

  const snap = status?.snapshot;

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 p-6 text-left hover:bg-muted/20 transition-colors"
      >
        <Activity className="h-5 w-5 text-cyan-400 flex-shrink-0" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">Sippy Change Detection Watcher</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto-monitors accounts, vendor IPs &amp; connections every 5 min — emails on any change
          </p>
        </div>
        <div className="flex items-center gap-2 mr-2">
          {status?.initialized ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Active
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Starting…
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-5 border-t border-border/50">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading watcher status…
            </div>
          ) : (
            <>
              {/* Alert destination banner */}
              <div className="mt-4 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-sm">
                <p className="font-medium text-cyan-300 mb-1">📧 Alert Destination</p>
                <p className="text-muted-foreground text-xs">
                  Alerts are sent to the <span className="text-foreground font-medium">Admin Alert Email</span> configured in
                  the <span className="text-cyan-400">Email Alert Configuration</span> panel above.
                  Make sure you have entered an email address and enabled alerts there.
                </p>
              </div>

              {/* Last run info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Last Run</p>
                  <p className="text-sm font-medium font-mono">
                    {status?.lastRunAt ? new Date(status.lastRunAt).toLocaleTimeString() : '—'}
                  </p>
                  {status?.lastRunAt && (
                    <p className="text-xs text-muted-foreground">{new Date(status.lastRunAt).toLocaleDateString()}</p>
                  )}
                </div>
                <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Changes Detected</p>
                  <p className={`text-sm font-bold ${status?.lastRunChanges ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {status?.lastRunChanges ?? 0}
                  </p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Poll Interval</p>
                  <p className="text-sm font-medium">5 min</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Status</p>
                  {status?.lastRunError ? (
                    <p className="text-sm text-red-400 font-medium">Error</p>
                  ) : status?.initialized ? (
                    <p className="text-sm text-emerald-400 font-medium">Running</p>
                  ) : (
                    <p className="text-sm text-amber-400 font-medium">Starting</p>
                  )}
                </div>
              </div>

              {status?.lastRunError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>Last run error: {status.lastRunError}</span>
                </div>
              )}

              {/* Snapshot summary */}
              {snap && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Sippy Snapshot</p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {[
                      { label: 'Client Accounts', value: snap.accounts, color: 'text-violet-400' },
                      { label: 'Vendors', value: snap.vendors, color: 'text-cyan-400' },
                      { label: 'Connections', value: snap.connections, color: 'text-blue-400' },
                      { label: 'Auth IP Rules', value: snap.authRules, color: 'text-emerald-400' },
                      { label: 'Traffic Clients', value: snap.seenClients, color: 'text-amber-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-muted/20 border border-border/50 rounded-lg p-3 text-center">
                        <p className={`text-2xl font-bold ${color}`}>{value}</p>
                        <p className="text-xs text-muted-foreground mt-1">{label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                    <div className="bg-muted/20 border border-border/50 rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Client Account Names</p>
                      <div className="flex flex-wrap gap-1">
                        {snap.accountNames.map(n => (
                          <span key={n} className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 text-xs font-mono">{n}</span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-muted/20 border border-border/50 rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Vendor Names</p>
                      <div className="flex flex-wrap gap-1">
                        {snap.vendorNames.map(n => (
                          <span key={n} className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 text-xs font-mono">{n}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Snapshot taken: {new Date(snap.capturedAt).toUTCString()}</p>
                </div>
              )}

              {/* What alerts look like */}
              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground/70">What triggers an alert email:</p>
                <p>• 🔐 Auth IP added / removed / changed on any client account</p>
                <p>• 🆕 New client account created in Sippy</p>
                <p>• 🗑️ Client account removed from Sippy</p>
                <p>• 🆕 New vendor or connection added</p>
                <p>• 🗑️ Vendor or connection removed</p>
                <p>• 📞 A client account sends traffic for the first time ever</p>
                <p className="mt-1 text-amber-400/80">Each alert email includes a full snapshot of the before &amp; after state so you can see exactly what changed.</p>
              </div>

              {/* Test button */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  data-testid="button-test-watcher-alert"
                  onClick={() => { setTestResult(null); testMut.mutate(); }}
                  disabled={testMut.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50"
                >
                  {testMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send Test Alert Email
                </button>
                <button
                  type="button"
                  data-testid="button-refresh-watcher-status"
                  onClick={() => refetch()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground border border-border hover:bg-muted/50"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </button>
              </div>

              {testResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult.ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  {testResult.ok ? <MailCheck className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  {testResult.ok
                    ? 'Test alert sent! Check your Admin Alert Email inbox — it includes the current system snapshot.'
                    : `Failed: ${testResult.error}`}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SippyUsersPanel() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState<SippyPortalUser | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_USER_FORM });
  const [showPassword, setShowPassword] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: usersData, isLoading, refetch } = useQuery<{ users: SippyPortalUser[]; error?: string }>({
    queryKey: ['/api/sippy/users'],
    enabled: expanded,
  });

  const users = usersData?.users ?? [];
  const apiError = usersData?.error;

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_USER_FORM });
    setFeedback(null);
    setIsAdding(true);
  }
  function openEdit(u: SippyPortalUser) {
    setEditing(u);
    setForm({
      name: u.name, login: u.login, password: '',
      accessLevel: u.accessLevel || 'Administrator',
      description: u.description || '', email: u.email || '',
      timezone: u.timezone || 'Etc/UTC', language: u.language || 'English',
      allowedHosts: u.allowedHosts || '', startPage: u.startPage || 'Monitoring',
    });
    setFeedback(null);
    setIsAdding(true);
  }
  function closeForm() { setIsAdding(false); setEditing(null); setFeedback(null); }

  async function save() {
    if (!form.name.trim()) { setFeedback({ ok: false, msg: 'Name is required.' }); return; }
    if (!form.login.trim()) { setFeedback({ ok: false, msg: 'Web Login is required.' }); return; }
    if (!editing && !form.password.trim()) { setFeedback({ ok: false, msg: 'Password is required for new users.' }); return; }
    try {
      const payload = { ...form };
      if (!payload.password) delete (payload as any).password;
      let result: any;
      if (editing) {
        result = await apiRequest('PATCH', `/api/sippy/users/${editing.userId}`, payload);
      } else {
        result = await apiRequest('POST', '/api/sippy/users', payload);
      }
      if (result.success) {
        setFeedback({ ok: true, msg: result.message });
        qc.invalidateQueries({ queryKey: ['/api/sippy/users'] });
        setTimeout(closeForm, 1200);
      } else {
        setFeedback({ ok: false, msg: result.message || 'Operation failed.' });
      }
    } catch (e: any) {
      setFeedback({ ok: false, msg: e.message || 'Request failed.' });
    }
  }

  async function deleteUser(userId: string) {
    setDeletingId(userId);
    try {
      await apiRequest('DELETE', `/api/sippy/users/${userId}`);
      qc.invalidateQueries({ queryKey: ['/api/sippy/users'] });
    } catch { } finally { setDeletingId(null); }
  }

  const field = (label: string, key: keyof typeof EMPTY_USER_FORM, opts?: { type?: string; placeholder?: string; required?: boolean }) => (
    <div className="grid gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}{opts?.required && <span className="text-rose-400 ml-0.5">*</span>}</label>
      <input
        type={opts?.type || 'text'}
        placeholder={opts?.placeholder}
        value={(form as any)[key] || ''}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        data-testid={`input-sippy-user-${key}`}
      />
    </div>
  );

  const select = (label: string, key: keyof typeof EMPTY_USER_FORM, options: string[]) => (
    <div className="grid gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        value={(form as any)[key] || ''}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        data-testid={`select-sippy-user-${key}`}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors"
        data-testid="accordion-sippy-users"
      >
        <Users className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <div className="flex-1 text-left">
          <h3 className="font-semibold text-sm">Sippy Portal Users</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage web portal users for your Sippy softswitch (Name, Login, Access Level, etc.)
          </p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="p-6 space-y-4">
          {/* Add New + Refresh */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {isLoading ? 'Loading users...' : apiError ? '' : `${users.length} user${users.length !== 1 ? 's' : ''} configured`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-muted/40 border border-border hover:bg-muted/60 transition-colors"
                data-testid="button-refresh-sippy-users"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </button>
              <button
                type="button"
                onClick={openNew}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                data-testid="button-add-sippy-user"
              >
                <UserPlus className="w-3 h-3" />
                Add New
              </button>
            </div>
          </div>

          {/* API error */}
          {apiError && (
            <div className="flex items-center gap-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl text-sm text-amber-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{apiError}</span>
            </div>
          )}

          {/* Users table */}
          {!isLoading && !apiError && (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground border-b border-border/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Web Login</th>
                    <th className="px-4 py-3 text-left font-medium">Description</th>
                    <th className="px-4 py-3 text-left font-medium">Access Level</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {users.map((u, i) => (
                    <tr key={u.userId} className="hover:bg-muted/20 transition-colors" data-testid={`row-sippy-user-${i}`}>
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3 font-mono text-sm text-muted-foreground">{u.login}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{u.description || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20">
                          {u.accessLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                            data-testid={`button-edit-sippy-user-${i}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteUser(u.userId)}
                            disabled={deletingId === u.userId}
                            className="p-1.5 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors disabled:opacity-50"
                            data-testid={`button-delete-sippy-user-${i}`}
                          >
                            {deletingId === u.userId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        No users found. Make sure Sippy is connected, then click Refresh.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Add/Edit User Form */}
          {isAdding && (
            <div className="border border-primary/20 bg-primary/5 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-semibold text-sm">{editing ? 'Edit User' : 'New User'}</h4>
                <button type="button" onClick={closeForm} className="p-1 rounded hover:bg-muted/40 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Row 1: Name + Web Login */}
              <div className="grid grid-cols-2 gap-3">
                {field('Name', 'name', { required: true, placeholder: 'Display name' })}
                {field('Web Login', 'login', { required: true, placeholder: 'username' })}
              </div>

              {/* Row 2: Web Password */}
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Web Password{!editing && <span className="text-rose-400 ml-0.5">*</span>}
                  {editing && <span className="text-muted-foreground/50 ml-1">(leave blank to keep current)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={editing ? 'Leave blank to keep unchanged' : 'Enter password'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    data-testid="input-sippy-user-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Row 3: Access Level + Time Zone */}
              <div className="grid grid-cols-2 gap-3">
                {select('Access Level', 'accessLevel', ACCESS_LEVELS)}
                {select('Time Zone', 'timezone', TIMEZONES)}
              </div>

              {/* Row 4: Language + Start Page */}
              <div className="grid grid-cols-2 gap-3">
                {select('Language', 'language', LANGUAGES)}
                {select('Start Page', 'startPage', START_PAGES)}
              </div>

              {/* Row 5: Description + Email */}
              <div className="grid grid-cols-2 gap-3">
                {field('Description', 'description', { placeholder: 'Optional description' })}
                {field('E-Mail', 'email', { type: 'email', placeholder: 'user@example.com' })}
              </div>

              {/* Row 6: Allowed Hosts */}
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Allowed Hosts</label>
                <input
                  type="text"
                  placeholder="175.107.203.134, 118.103.235.186"
                  value={form.allowedHosts}
                  onChange={e => setForm(f => ({ ...f, allowedHosts: e.target.value }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  data-testid="input-sippy-user-allowedHosts"
                />
                <p className="text-xs text-muted-foreground/60">Comma-separated IP addresses allowed to log in. Leave blank to allow all.</p>
              </div>

              {feedback && (
                <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${feedback.ok ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20'}`}>
                  {feedback.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                  {feedback.msg}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" onClick={closeForm} className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-muted/40 transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  data-testid="button-save-sippy-user"
                >
                  <Save className="w-3.5 h-3.5" />
                  {editing ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Additional Switches Panel ─────────────────────────────────────────────────
type SwitchRow = {
  id: number; name: string; type: string;
  portalUrl: string | null; portalUsername: string | null; portalPassword: string | null;
  enabled: boolean; notes: string | null;
  lastSyncAt: string | null; lastSyncStatus: string | null;
};

const EMPTY_SWITCH: Omit<SwitchRow, 'id' | 'lastSyncAt' | 'lastSyncStatus'> = {
  name: '', type: 'sippy', portalUrl: '', portalUsername: '', portalPassword: '',
  enabled: true, notes: '',
};

function SwitchesPanel() {
  const qc = useQueryClient();
  const { data: switches = [], isLoading } = useQuery<SwitchRow[]>({ queryKey: ['/api/switches'] });

  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState<SwitchRow | null>(null);
  const [form, setForm] = useState<Omit<SwitchRow, 'id' | 'lastSyncAt' | 'lastSyncStatus'>>({ ...EMPTY_SWITCH });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_SWITCH });
    setError(null);
  }
  function openEdit(sw: SwitchRow) {
    setEditing(sw);
    setForm({ name: sw.name, type: sw.type, portalUrl: sw.portalUrl || '', portalUsername: sw.portalUsername || '', portalPassword: sw.portalPassword || '', enabled: sw.enabled, notes: sw.notes || '' });
    setError(null);
  }
  function closeForm() { setEditing(null); setForm({ ...EMPTY_SWITCH }); setError(null); }

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.portalUrl?.trim()) { setError('URL is required'); return; }
    setSaving(true); setError(null);
    try {
      if (editing) {
        await apiRequest('PATCH', `/api/switches/${editing.id}`, form);
      } else {
        await apiRequest('POST', '/api/switches', form);
      }
      qc.invalidateQueries({ queryKey: ['/api/switches'] });
      closeForm();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally { setSaving(false); }
  }

  async function deleteSw(id: number) {
    setDeleting(id);
    try {
      await apiRequest('DELETE', `/api/switches/${id}`);
      qc.invalidateQueries({ queryKey: ['/api/switches'] });
    } catch { } finally { setDeleting(null); }
  }

  const isFormOpen = editing !== null || (form.name !== '' || form.portalUrl !== '');

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors"
      >
        <Server className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <div className="flex-1 text-left">
          <h3 className="font-semibold text-sm">Additional Switches</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add extra Sippy instances to push rates to multiple softswitches simultaneously.
          </p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="p-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : switches.length === 0 && !isFormOpen ? (
            <p className="text-sm text-muted-foreground">No additional switches configured. Click Add Switch to connect another softswitch.</p>
          ) : (
            <div className="space-y-2">
              {switches.map(sw => (
                <div key={sw.id} data-testid={`switch-row-${sw.id}`} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/50">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sw.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{sw.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-violet-500/20 text-violet-300">{sw.type}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{sw.portalUrl}</p>
                    {sw.lastSyncStatus && (
                      <p className={`text-xs mt-0.5 ${sw.lastSyncStatus.startsWith('failed') ? 'text-rose-400' : 'text-emerald-400'}`}>{sw.lastSyncStatus}</p>
                    )}
                  </div>
                  <button type="button" data-testid={`button-edit-switch-${sw.id}`} onClick={() => openEdit(sw)} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" data-testid={`button-delete-switch-${sw.id}`} onClick={() => deleteSw(sw.id)} disabled={deleting === sw.id} className="p-1.5 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors disabled:opacity-40">
                    {deleting === sw.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Inline add/edit form */}
          {isFormOpen ? (
            <div className="border border-border/80 rounded-lg p-4 space-y-3 bg-background/40">
              <p className="text-sm font-semibold">{editing ? 'Edit Switch' : 'Add New Switch'}</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">Name</label>
                  <input
                    data-testid="input-switch-name"
                    value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Primary US Switch"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">Type</label>
                  <select
                    data-testid="select-switch-type"
                    value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="sippy">Sippy</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-1.5">
                <label className="text-xs font-medium">Portal URL</label>
                <input
                  data-testid="input-switch-url"
                  value={form.portalUrl || ''} onChange={e => setForm(f => ({ ...f, portalUrl: e.target.value }))}
                  placeholder="http://192.168.1.100:8081/eng/"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">Username</label>
                  <input
                    data-testid="input-switch-username"
                    value={form.portalUsername || ''} onChange={e => setForm(f => ({ ...f, portalUsername: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">Password</label>
                  <input
                    data-testid="input-switch-password"
                    type="password"
                    value={form.portalPassword || ''} onChange={e => setForm(f => ({ ...f, portalPassword: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <label className="text-xs font-medium">Notes (optional)</label>
                <input
                  data-testid="input-switch-notes"
                  value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. US West Coast, Customer A"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="switch-enabled"
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-border"
                />
                <label htmlFor="switch-enabled" className="text-xs text-muted-foreground">Enabled (include in multi-switch pushes)</label>
              </div>

              {error && <p className="text-xs text-rose-400">{error}</p>}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  data-testid="button-save-switch"
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {editing ? 'Save Changes' : 'Add Switch'}
                </button>
                <button
                  type="button"
                  data-testid="button-cancel-switch"
                  onClick={closeForm}
                  className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-testid="button-add-switch"
              onClick={openNew}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border/70 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Switch
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── SNMP Test Button ─────────────────────────────────────────────────────────
function SnmpTestButton({ host, port, community, environments }: {
  host: string; port: number; community: string; environments: string;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; activeCalls?: number; acd?: number; asr?: number } | null>(null);

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      const cleanHost = host.startsWith('http') ? new URL(host).hostname : host.split(':')[0].split('/')[0];
      const res = await fetch('/api/sippy/snmp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: cleanHost, port, community, environments }),
      });
      const data = await res.json();
      if (data.ok) {
        const totalActive = (data.environments ?? []).reduce((s: number, e: any) => s + (e.activeCalls ?? 0), 0);
        setResult({ ok: true, activeCalls: totalActive, acd: data.acd, asr: data.asr });
      } else {
        setResult({ ok: false, message: data.error ?? 'SNMP query failed.' });
      }
    } catch (e: any) {
      setResult({ ok: false, message: e.message ?? 'Network error.' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        data-testid="button-test-snmp"
        onClick={runTest}
        disabled={testing || !host}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border/70 bg-muted/20 hover:bg-muted/40 transition-colors disabled:opacity-50"
      >
        {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
        Test SNMP Connection
      </button>
      {result && (
        <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${result.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {result.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          {result.ok
            ? <span>SNMP reachable — Active Calls: <strong>{result.activeCalls}</strong> · ACD: <strong>{result.acd?.toFixed(1)}s</strong> · ASR: <strong>{result.asr?.toFixed(1)}%</strong></span>
            : <span>{result.message}</span>}
        </div>
      )}
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateMutation = useUpdateSettings();
  const resetMutation = useResetSimulation();
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [isTesting, setIsTesting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: settings || {
      jitterThreshold: 30,
      latencyThreshold: 150,
      packetLossThreshold: 1.0,
      simulationEnabled: false,
      monitoredIp: '45.59.163.182',
      switchType: 'sippy',
      portalUrl: 'https://191.101.30.107',
      portalUsername: 'RTST1',
      portalPassword: 'abcd@1234',
      apiAdminUsername: 'ssp-root',
      apiAdminPassword: '!chiaan1',
      snmpEnabled: false,
      snmpHost: '',
      snmpPort: 161,
      snmpCommunity: 'public',
      snmpEnvironments: '1',
    },
  });

  const onSubmit = (data: FormValues) => {
    updateMutation.mutate(data);
  };

  async function testPortalConnection() {
    const url = form.getValues('portalUrl');
    const switchType = form.getValues('switchType');
    if (!url) {
      setTestResult({ ok: false, message: 'Please enter a Portal URL first.' });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    const endpoint = '/api/sippy/test';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          username: form.getValues('portalUsername'),
          password: form.getValues('portalPassword'),
          apiAdminUsername: form.getValues('apiAdminUsername'),
          apiAdminPassword: form.getValues('apiAdminPassword'),
        }),
      });
      const data = await res.json();
      // For Sippy, success requires both reachable AND authenticated
      const ok = switchType === 'sippy'
        ? (res.ok && data.reachable && data.authenticated)
        : (res.ok && data.reachable);
      setTestResult({ ok, message: data.message || (ok ? 'Connected successfully' : 'Connection failed') });
    } catch {
      setTestResult({ ok: false, message: 'Network error — could not reach the portal.' });
    } finally {
      setIsTesting(false);
    }
  }

  if (isLoading) return <div className="p-8">Loading settings…</div>;

  const portalUrl = form.watch('portalUrl');
  const portalUsername = form.watch('portalUsername');
  const portalPassword = form.watch('portalPassword');
  const switchType = form.watch('switchType') ?? 'sippy';
  const hasSavedPortal = !!(settings?.portalUrl && settings?.portalUsername && settings?.portalPassword);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Configuration</h2>
        <p className="text-muted-foreground mt-1">Adjust monitoring thresholds, portal access, and simulation parameters.</p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

        {/* ── Management Portal Access ── */}
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-muted/20">
            <Globe className="w-4 h-4 text-blue-400" />
            <div>
              <h3 className="font-semibold text-sm">Softswitch Integration</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Connect to your carrier softswitch to pull live call data, CDR records, traffic reports, and billing records.
              </p>
            </div>
          </div>
          <div className="p-6 space-y-5">

            {/* Switch Type — Sippy only */}
            <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-violet-500 bg-violet-500/10">
              <div className="flex-1">
                <div className="text-sm font-semibold text-violet-400 mb-0.5">Sippy Softswitch</div>
                <div className="text-xs text-muted-foreground">Sippy Software softswitch — XML-RPC API with Digest Auth</div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">Active</span>
            </div>
            <input type="hidden" {...form.register('switchType')} />

            {/* Portal URL */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Portal URL</label>
              <p className="text-xs text-muted-foreground">
                Full URL including port — e.g. <span className="font-mono text-xs">https://191.101.30.107</span> (Sippy default HTTPS port is <strong>443</strong>)
              </p>
              <div className="rounded-md bg-violet-500/10 border border-violet-500/20 px-3 py-2.5 text-xs text-violet-300 space-y-1.5">
                <p className="font-semibold text-violet-200">How to find your Sippy API credentials:</p>
                <p>1. Open your Sippy portal:{' '}
                  <a
                    href="https://191.101.30.107/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-violet-200 hover:text-white"
                  >
                    https://191.101.30.107/
                  </a>
                </p>
                <p>2. Log in as an administrator, then click your username (top-right) → <strong>My Account</strong></p>
                <p>3. Find the <strong>API Credentials</strong> tab — copy the <strong>API Login</strong> and <strong>API Password</strong></p>
                <p className="text-violet-300/70">These are different from your regular web login — they are dedicated API-only credentials.</p>
              </div>
              <div className="flex gap-2">
                <input
                  {...form.register("portalUrl")}
                  data-testid="input-portal-url"
                  type="url"
                  placeholder="https://191.101.30.107"
                  className="flex-1 bg-background border border-border rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
                {portalUrl && (
                  <a
                    href={portalUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open
                  </a>
                )}
              </div>
            </div>

            {/* Username */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">API Login (Username)</label>
              <p className="text-xs text-muted-foreground">Found under <strong>My Account → API Credentials</strong> in your Sippy portal</p>
              <input
                {...form.register("portalUsername")}
                data-testid="input-portal-username"
                type="text"
                autoComplete="username"
                placeholder="API login from Sippy portal"
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>

            {/* Password */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">API Password</label>
              <div className="relative">
                <input
                  {...form.register("portalPassword")}
                  data-testid="input-portal-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full bg-background border border-border rounded-lg px-4 py-2 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
                <button
                  type="button"
                  data-testid="button-toggle-password"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Test connection */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                data-testid="button-test-portal"
                onClick={testPortalConnection}
                disabled={isTesting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                {isTesting
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Globe className="w-3.5 h-3.5" />}
                Test Connection
              </button>

              {testResult && (
                <div className={`flex items-center gap-2 text-sm ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testResult.ok
                    ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    : <XCircle className="w-4 h-4 flex-shrink-0" />}
                  <span data-testid="text-portal-test-result">{testResult.message}</span>
                </div>
              )}
            </div>

            {/* Save reminder if not yet saved */}
            {!hasSavedPortal && (portalUrl || portalUsername) && (
              <p className="text-xs text-amber-400">
                Save Changes below to store your credentials, then use the Sign In section to connect.
              </p>
            )}
          </div>
        </div>

        {/* ── Sippy XML-RPC Admin Credentials ── */}
        {switchType === 'sippy' && (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-muted/20">
              <ShieldCheck className="w-4 h-4 text-violet-400" />
              <div>
                <h3 className="font-semibold text-sm">Sippy Admin API Credentials</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Required for account creation, tariff lists, and all XML-RPC API operations. Separate from the portal login above.
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3 text-xs text-muted-foreground space-y-1">
                <p>Your <strong>portal login</strong> (above) is used for viewing calls and CDR data via the web portal session.</p>
                <p>Your <strong>admin API credentials</strong> (here) are used for the Sippy XML-RPC API — required to create accounts, list tariffs, manage routing groups, etc.</p>
                <p>To find these: log into your Sippy portal as an administrator → click your username (top-right) → <strong>My Account → API Credentials</strong>.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Admin API Username</label>
                  <input
                    {...form.register("apiAdminUsername")}
                    data-testid="input-api-admin-username"
                    type="text"
                    autoComplete="off"
                    placeholder="e.g. admin"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Admin API Password</label>
                  <input
                    {...form.register("apiAdminPassword")}
                    data-testid="input-api-admin-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>
              {form.watch('apiAdminUsername') && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Admin API credentials set — will be used for all XML-RPC operations. Click <strong>Save Changes</strong> to store them.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SNMP Monitoring ── */}
        {switchType === 'sippy' && (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-muted/20">
              <Radio className="w-4 h-4 text-violet-400" />
              <div>
                <h3 className="font-semibold text-sm">SNMP Monitoring</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Query live call statistics directly from the switch via SNMP (SIPPY-MIB). Provides ACD, ASR, RTP quality, and per-environment call counts.
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3 text-xs text-muted-foreground space-y-1">
                <p>SNMP must be enabled on the switch: add <code className="bg-muted px-1 rounded">pass_persist .1.3.6.1.4.1.36523 /home/ssp/scripts/snmp_statsd.py</code> to <code className="bg-muted px-1 rounded">/home/ssp/etc/snmpd.conf</code>, then restart snmpd.</p>
                <p>To allow remote access: add <code className="bg-muted px-1 rounded">rocommunity &lt;COMMUNITY&gt; &lt;YOUR_IP&gt;</code> to snmpd.conf.</p>
                <p>The SIPPY-MIB OID prefix is <strong>.1.3.6.1.4.1.36523</strong>. MIB file: <code className="bg-muted px-1 rounded">/usr/home/ssp/etc/SIPPY-MIB.txt</code></p>
              </div>

              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Enable SNMP Monitoring</label>
                  <p className="text-xs text-muted-foreground">When enabled, the dashboard polls SNMP stats on the Sippy switch.</p>
                </div>
                <button
                  type="button"
                  data-testid="toggle-snmp-enabled"
                  onClick={() => form.setValue('snmpEnabled', !form.watch('snmpEnabled'))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.watch('snmpEnabled') ? 'bg-violet-500' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.watch('snmpEnabled') ? 'translate-x-4' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">SNMP Host</label>
                  <input
                    {...form.register("snmpHost")}
                    data-testid="input-snmp-host"
                    type="text"
                    placeholder="e.g. 191.101.30.107 (auto-detected from Portal URL)"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">Leave blank to use the Portal URL host.</p>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">SNMP Port</label>
                  <input
                    {...form.register("snmpPort", { valueAsNumber: true })}
                    data-testid="input-snmp-port"
                    type="number"
                    placeholder="161"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Community String</label>
                  <input
                    {...form.register("snmpCommunity")}
                    data-testid="input-snmp-community"
                    type="text"
                    placeholder="public"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Environment IDs</label>
                  <input
                    {...form.register("snmpEnvironments")}
                    data-testid="input-snmp-environments"
                    type="text"
                    placeholder="1"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">Comma-separated Sippy environment IDs (e.g. 1,2,3).</p>
                </div>
              </div>

              {/* Test SNMP button */}
              <SnmpTestButton
                host={form.watch('snmpHost') || (form.watch('portalUrl') ? form.watch('portalUrl')! : '')}
                port={form.watch('snmpPort') ?? 161}
                community={form.watch('snmpCommunity') ?? 'public'}
                environments={form.watch('snmpEnvironments') ?? '1'}
              />
            </div>
          </div>
        )}

        {/* ── Switch Sign-In ── */}
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-muted/20">
            <ShieldCheck className="w-4 h-4 text-violet-400" />
            <div>
              <h3 className="font-semibold text-sm">Sippy Softswitch Sign-In</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Authenticate to start pulling live calls and CDR data into this dashboard.
              </p>
            </div>
          </div>
          <div className="p-6">
            {hasSavedPortal ? (
              <SippyConnectPanel
                username={settings!.portalUsername!}
                password={settings!.portalPassword!}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Enter your Portal URL, username, and password above, then click <strong>Save Changes</strong> to unlock sign-in.
              </p>
            )}
          </div>
        </div>

        {/* ── Monitoring Thresholds ── */}
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold text-sm">Monitoring & Simulation</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Live probe target and alert thresholds.</p>
          </div>
          <div className="p-6 space-y-5">

            <div className="grid gap-2">
              <label className="text-sm font-medium">Monitored IP Address</label>
              <p className="text-xs text-muted-foreground">
                IP address to probe every 10 seconds for live reachability and latency.
              </p>
              <div className="flex gap-2">
                <input
                  {...form.register("monitoredIp")}
                  data-testid="input-monitored-ip"
                  type="text"
                  placeholder="45.59.163.182"
                  className="flex-1 bg-background border border-border rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
                {form.watch("monitoredIp") && (
                  <button
                    type="button"
                    data-testid="button-disconnect-ip"
                    onClick={() => {
                      form.setValue("monitoredIp", "");
                      updateMutation.mutate({ ...form.getValues(), monitoredIp: "" });
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-500/40 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors whitespace-nowrap"
                  >
                    <X className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                )}
              </div>
              {/* Auto-monitored softswitch IP */}
              {(() => {
                const pUrl = form.watch("portalUrl");
                const sType = form.watch("switchType");
                if (!pUrl || sType !== 'sippy') return null;
                let switchHost = '';
                try { switchHost = new URL(pUrl).hostname; } catch { return null; }
                if (!switchHost) return null;
                return (
                  <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-lg bg-muted/30 border border-border/40 text-xs">
                    <span className="text-muted-foreground">Auto-monitored (Sippy switch):</span>
                    <span className="font-mono font-semibold">{switchHost}</span>
                    <span className="ml-auto text-muted-foreground/60 italic">probed every 10s</span>
                  </div>
                );
              })()}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Jitter Threshold (ms)</label>
              <p className="text-xs text-muted-foreground">Alert when jitter exceeds this value.</p>
              <input
                {...form.register("jitterThreshold", { valueAsNumber: true })}
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                type="number"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Latency Threshold (ms)</label>
              <p className="text-xs text-muted-foreground">Alert when round-trip delay exceeds this value.</p>
              <input
                {...form.register("latencyThreshold", { valueAsNumber: true })}
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                type="number"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Packet Loss Threshold (%)</label>
              <p className="text-xs text-muted-foreground">Alert when packet loss percentage exceeds this value.</p>
              <input
                {...form.register("packetLossThreshold", { valueAsNumber: true })}
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                type="number"
                step="0.1"
              />
            </div>

            {form.watch('simulationEnabled') && portalUrl && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                <span className="flex-shrink-0 mt-0.5">⚠</span>
                <span>
                  <strong>Conflict:</strong> Simulation is on but a softswitch portal is also configured.
                  Simulation will be automatically disabled on the next server restart to prevent fake data mixing with live traffic.
                  Turn off Simulation below to fix this now.
                </span>
              </div>
            )}
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
              <div>
                <label className="text-sm font-medium block">Simulation Mode</label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Generate synthetic VoIP traffic for testing.
                  {portalUrl ? ' Disable this when using a live softswitch.' : ''}
                </p>
              </div>
              <input
                {...form.register("simulationEnabled")}
                type="checkbox"
                className="h-5 w-5 rounded border-border bg-background text-primary focus:ring-primary/20"
              />
            </div>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            data-testid="button-save-settings"
            disabled={updateMutation.isPending}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          {updateMutation.isSuccess && (
            <span className="text-sm text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
        </div>
      </form>

      {/* Email Alert Configuration */}
      <EmailAlertPanel />

      {/* Sippy Change Watcher */}
      <SippyWatcherPanel />

      {/* Sippy Users */}
      <SippyUsersPanel />

      {/* Additional Switches */}
      <SwitchesPanel />

      {/* Danger Zone */}
      <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-destructive">Danger Zone</h3>
          <p className="text-sm text-destructive/80 mt-1">Reset all simulation data and clear alerts.</p>
        </div>
        <button
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {resetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Reset Simulation
        </button>
      </div>
    </div>
  );
}
