import { useSettings, useUpdateSettings, useResetSimulation } from "@/hooks/use-settings";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSettingsSchema } from "@shared/schema";
import { z } from "zod";
import { useState, useEffect } from "react";
import {
  Loader2, Save, RefreshCw, Eye, EyeOff, Globe, CheckCircle2,
  XCircle, ExternalLink, LogIn, LogOut, ShieldCheck, RefreshCcw,
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
});

type FormValues = z.infer<typeof formSchema>;
type TestResult = { ok: boolean; message: string } | null;

// ── Switch type definitions ───────────────────────────────────────────────────
const SWITCH_TYPES = [
  {
    id: 'vos3000',
    label: 'VOS3000',
    description: 'Linknat VOS3000 carrier softswitch (CAPTCHA-based login)',
    color: 'blue',
  },
  {
    id: 'sippy',
    label: 'Sippy Softswitch',
    description: 'Sippy Software softswitch (HTTP Basic Auth, XML-RPC API)',
    color: 'violet',
  },
] as const;

// ── Portal Session Status ─────────────────────────────────────────────────────
function usePortalSession() {
  return useQuery<{ active: boolean; username?: string; loggedInAt?: string; portalBase?: string }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
  });
}

function useSippySession() {
  return useQuery<{ active: boolean; username?: string; connectedAt?: string; portalBase?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
  });
}

// ── Portal Login Panel ────────────────────────────────────────────────────────
const VOS3000_LOGIN_TYPES = [
  { value: 0, label: 'Phone' },
  { value: 1, label: 'Mapping Gateway' },
  { value: 2, label: 'PhoneCard' },
  { value: 3, label: 'Clearing Gateway' },
  { value: 4, label: 'Binded Number' },
];

function PortalLoginPanel({ username, password }: { username: string; password: string }) {
  const qc = useQueryClient();
  const { data: session, isLoading: sessionLoading } = usePortalSession();

  const [loginType, setLoginType] = useState(1); // default: Mapping Gateway
  const [captchaImg, setCaptchaImg] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  const [fetchingCaptcha, setFetchingCaptcha] = useState(false);
  const [loginResult, setLoginResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function loadCaptcha() {
    setFetchingCaptcha(true);
    setCaptchaImg(null);
    setChallengeId(null);
    setLoginResult(null);
    setCaptchaCode('');
    try {
      const resp = await fetch('/api/portal/captcha');
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setLoginResult({ ok: false, message: body.error || 'Failed to fetch CAPTCHA from portal.' });
        return;
      }
      const data = await resp.json();
      setCaptchaImg(data.imageBase64);
      setChallengeId(data.challengeId);
    } catch {
      setLoginResult({ ok: false, message: 'Network error contacting portal.' });
    } finally {
      setFetchingCaptcha(false);
    }
  }

  async function handleLogin() {
    if (!challengeId || !captchaCode.trim()) return;
    setLoggingIn(true);
    setLoginResult(null);
    try {
      const resp = await fetch('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, challengeId, captchaCode, loginType }),
      });
      const data = await resp.json();
      setLoginResult({ ok: data.success, message: data.message });
      if (data.success) {
        qc.invalidateQueries({ queryKey: ['/api/portal/session'] });
        setCaptchaImg(null);
        setChallengeId(null);
        setCaptchaCode('');
      } else {
        // Wrong captcha — load a new one automatically
        loadCaptcha();
      }
    } catch {
      setLoginResult({ ok: false, message: 'Network error during login.' });
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch('/api/portal/session', { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['/api/portal/session'] });
      setLoginResult(null);
    } finally {
      setLoggingOut(false);
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
    return (
      <div className="space-y-4">
        {/* Active session badge */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <p className="text-sm font-semibold text-emerald-400">Connected to VOS3000</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Logged in as <span className="font-mono">{session.username}</span>
                {session.loggedInAt && (
                  <> · since {new Date(session.loggedInAt).toLocaleTimeString()}</>
                )}
              </p>
            </div>
          </div>
          <button
            data-testid="button-portal-logout"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-rose-400 hover:border-rose-400/50 transition-colors disabled:opacity-50"
          >
            {loggingOut ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
            Logout
          </button>
        </div>

        {/* Info: live data is flowing */}
        <p className="text-xs text-muted-foreground">
          Live CDR records and call stats are now being pulled from the VOS3000 portal.
          Check the <strong>Dashboard</strong> and <strong>Reports</strong> pages.
        </p>
      </div>
    );
  }

  // Not logged in — show CAPTCHA login flow
  return (
    <div className="space-y-4">
      {/* Status / result */}
      {loginResult && (
        <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${loginResult.ok ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-400 border-rose-500/30 bg-rose-500/10'}`}>
          {loginResult.ok
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <XCircle className="w-4 h-4 flex-shrink-0" />}
          <span data-testid="text-portal-login-result">{loginResult.message}</span>
        </div>
      )}

      {/* Account Type Selector */}
      <div className="grid gap-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account Type</label>
        <div className="flex flex-wrap gap-2">
          {VOS3000_LOGIN_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              data-testid={`button-login-type-${t.value}`}
              onClick={() => setLoginType(t.value)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                loginType === t.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground hover:border-primary/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Explanation */}
      {!captchaImg && !fetchingCaptcha && (
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-4 space-y-2">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">One-Time Login Required</p>
          <p className="text-xs text-muted-foreground">
            VOS3000 requires a visual verification code (CAPTCHA) for every login.
            Click the button below to load the code from the portal — you'll type what you see to complete sign-in.
            Your session stays active until the server restarts.
          </p>
        </div>
      )}

      {/* CAPTCHA display */}
      {captchaImg && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="border border-border rounded-lg p-2 bg-white">
              <img
                src={captchaImg}
                alt="CAPTCHA verification code"
                className="h-10 object-contain"
                style={{ imageRendering: 'pixelated' }}
                data-testid="img-captcha"
              />
            </div>
            <button
              type="button"
              onClick={loadCaptcha}
              disabled={fetchingCaptcha}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-refresh-captcha"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              New code
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={captchaCode}
              onChange={e => setCaptchaCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              type="text"
              placeholder="Type the code you see above"
              maxLength={10}
              autoFocus
              data-testid="input-captcha-code"
              className="flex-1 bg-background border border-border rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            <button
              type="button"
              onClick={handleLogin}
              disabled={loggingIn || !captchaCode.trim()}
              data-testid="button-portal-login"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              Sign in
            </button>
          </div>
        </div>
      )}

      {/* Load captcha button */}
      {!captchaImg && (
        <button
          type="button"
          onClick={loadCaptcha}
          disabled={fetchingCaptcha}
          data-testid="button-load-captcha"
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
        >
          {fetchingCaptcha
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <LogIn className="w-3.5 h-3.5" />}
          {fetchingCaptcha ? 'Loading verification code…' : 'Load Verification Code & Sign In'}
        </button>
      )}
    </div>
  );
}

// ── Sippy Connect Panel ────────────────────────────────────────────────────────
function SippyConnectPanel({ username, password }: { username: string; password: string }) {
  const qc = useQueryClient();
  const { data: session, isLoading: sessionLoading } = useSippySession();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

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
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <p className="text-sm font-semibold text-emerald-400">Connected to Sippy Softswitch</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Logged in as <span className="font-mono">{session.username}</span>
                {session.connectedAt && (
                  <> · since {new Date(session.connectedAt).toLocaleTimeString()}</>
                )}
              </p>
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
          Live call data and CDR records from your Sippy Softswitch are now available on the Dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {result && (
        <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${result.ok ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-400 border-rose-500/30 bg-rose-500/10'}`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          <span data-testid="text-sippy-connect-result">{result.message}</span>
        </div>
      )}

      <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-4 space-y-2">
        <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">HTTP Basic Auth</p>
        <p className="text-xs text-muted-foreground">
          Sippy uses standard HTTP Basic Auth — no CAPTCHA needed. Click Connect to authenticate immediately using your saved credentials.
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
      simulationEnabled: true,
      monitoredIp: '45.59.163.182',
      switchType: 'vos3000',
      portalUrl: '',
      portalUsername: '',
      portalPassword: '',
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
    const endpoint = switchType === 'sippy' ? '/api/sippy/test' : '/api/portal/test';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, username: form.getValues('portalUsername'), password: form.getValues('portalPassword') }),
      });
      const data = await res.json();
      setTestResult({ ok: res.ok && data.reachable, message: data.message || (res.ok ? 'Connected successfully' : 'Connection failed') });
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
  const switchType = form.watch('switchType') ?? 'vos3000';
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

            {/* Switch Type Selector */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Softswitch Type</label>
              <p className="text-xs text-muted-foreground">Select the type of softswitch you are connecting to.</p>
              <div className="grid grid-cols-2 gap-3">
                {SWITCH_TYPES.map(sw => (
                  <button
                    key={sw.id}
                    type="button"
                    data-testid={`button-switch-type-${sw.id}`}
                    onClick={() => form.setValue('switchType', sw.id, { shouldDirty: true })}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${
                      switchType === sw.id
                        ? sw.id === 'vos3000'
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-violet-500 bg-violet-500/10'
                        : 'border-border bg-background hover:border-muted-foreground/30'
                    }`}
                  >
                    <div className={`text-sm font-semibold mb-1 ${
                      switchType === sw.id
                        ? sw.id === 'vos3000' ? 'text-blue-400' : 'text-violet-400'
                        : 'text-foreground'
                    }`}>
                      {sw.label}
                    </div>
                    <div className="text-xs text-muted-foreground leading-relaxed">{sw.description}</div>
                  </button>
                ))}
              </div>
              <input type="hidden" {...form.register('switchType')} />
            </div>

            {/* Portal URL */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Portal URL</label>
              <p className="text-xs text-muted-foreground">
                Full URL including port if needed — e.g. <span className="font-mono text-xs">http://45.59.163.182:8080</span> or <span className="font-mono text-xs">https://portal.carrier.com</span>
              </p>
              <div className="flex gap-2">
                <input
                  {...form.register("portalUrl")}
                  data-testid="input-portal-url"
                  type="url"
                  placeholder="http://45.59.163.182:8080"
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
              <label className="text-sm font-medium">Admin Username</label>
              <input
                {...form.register("portalUsername")}
                data-testid="input-portal-username"
                type="text"
                autoComplete="username"
                placeholder="admin"
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>

            {/* Password */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Admin Password</label>
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

        {/* ── Switch Sign-In ── */}
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-muted/20">
            <ShieldCheck className={`w-4 h-4 ${switchType === 'sippy' ? 'text-violet-400' : 'text-blue-400'}`} />
            <div>
              <h3 className="font-semibold text-sm">
                {switchType === 'sippy' ? 'Sippy Softswitch Sign-In' : 'VOS3000 Portal Sign-In'}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Authenticate to start pulling live calls and CDR data into this dashboard.
              </p>
            </div>
          </div>
          <div className="p-6">
            {hasSavedPortal ? (
              switchType === 'sippy' ? (
                <SippyConnectPanel
                  username={settings!.portalUsername!}
                  password={settings!.portalPassword!}
                />
              ) : (
                <PortalLoginPanel
                  username={settings!.portalUsername!}
                  password={settings!.portalPassword!}
                />
              )
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
              <input
                {...form.register("monitoredIp")}
                data-testid="input-monitored-ip"
                type="text"
                placeholder="45.59.163.182"
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
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
