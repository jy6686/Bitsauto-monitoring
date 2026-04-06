import { useSettings, useUpdateSettings, useResetSimulation } from "@/hooks/use-settings";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSettingsSchema } from "@shared/schema";
import { z } from "zod";
import { useState } from "react";
import { Loader2, Save, RefreshCw, Eye, EyeOff, Globe, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const formSchema = insertSettingsSchema.pick({
  jitterThreshold: true,
  latencyThreshold: true,
  packetLossThreshold: true,
  simulationEnabled: true,
  monitoredIp: true,
  portalUrl: true,
  portalUsername: true,
  portalPassword: true,
});

type FormValues = z.infer<typeof formSchema>;

type TestResult = { ok: boolean; message: string } | null;

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
    const username = form.getValues('portalUsername');
    if (!url) {
      setTestResult({ ok: false, message: 'Please enter a Portal URL first.' });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/portal/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, username, password: form.getValues('portalPassword') }),
      });
      const data = await res.json();
      setTestResult({ ok: res.ok && data.reachable, message: data.message || (res.ok ? 'Connected successfully' : 'Connection failed') });
    } catch {
      setTestResult({ ok: false, message: 'Network error — could not reach the portal.' });
    } finally {
      setIsTesting(false);
    }
  }

  if (isLoading) return <div className="p-8">Loading settings...</div>;

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
              <h3 className="font-semibold text-sm">Management Portal Access</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Connect to the carrier web portal to pull real call logs, traffic reports, routing tables, and billing records.
              </p>
            </div>
          </div>
          <div className="p-6 space-y-5">

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
                {form.watch("portalUrl") && (
                  <a
                    href={form.watch("portalUrl") || '#'}
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

            {/* What this unlocks */}
            <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-4 space-y-2">
              <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">When connected, you get access to:</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />Full CDR call logs with real timestamps, durations, and routes</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />Live traffic reports and active call counts</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />Routing tables showing call paths and carrier trunks</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />Billing records and per-minute rate details</li>
              </ul>
            </div>
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

            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
              <div>
                <label className="text-sm font-medium block">Simulation Enabled</label>
                <p className="text-xs text-muted-foreground mt-0.5">Generate synthetic VoIP traffic for testing.</p>
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
