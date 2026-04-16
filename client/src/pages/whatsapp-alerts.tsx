
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { MessageSquare, Send, CheckCircle2, XCircle, Clock, RefreshCw, ExternalLink, Shield, Activity, Wifi, WifiOff } from "lucide-react";
import type { Settings } from "@shared/schema";
import type { WhatsappAlertLog } from "@shared/schema";

const ALERT_TYPES = [
  { id: 'fas',     label: 'FAS / Fraud',      icon: '🚨', desc: 'False Answer Supervision detected'    },
  { id: 'balance', label: 'Low Balance',       icon: '⚠️', desc: 'Account balance below threshold'      },
  { id: 'traffic', label: 'Traffic Alerts',    icon: '📉', desc: 'Traffic gone or dropped for a client' },
  { id: 'auth',    label: 'Auth IP Changes',   icon: '🔐', desc: 'IP rules added, removed, or changed'  },
  { id: 'outage',  label: 'Outage / Recovery', icon: '🔴', desc: 'Sippy switch down or recovered'       },
  { id: 'quality', label: 'Call Quality',      icon: '📊', desc: 'MOS / jitter / packet-loss threshold' },
] as const;

function alertTypeLabel(type: string) {
  return ALERT_TYPES.find(a => a.id === type)?.label ?? type;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'sent') {
    return (
      <Badge className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Sent
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge className="text-xs bg-rose-500/15 text-rose-400 border-rose-500/30 gap-1">
        <XCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  }
  return (
    <Badge className="text-xs bg-muted text-muted-foreground gap-1">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

export default function WhatsappAlertsPage() {
  const { toast } = useToast();

  // ── Plain state (no react-hook-form to avoid infinite-render issues) ──────
  const [enabled,    setEnabled]    = useState(false);
  const [provider,   setProvider]   = useState<'callmebot' | 'ultramsg'>('callmebot');
  const [phones,     setPhones]     = useState('');
  const [apiKey,     setApiKey]     = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [alertTypes, setAlertTypes] = useState('fas,balance,traffic,outage,auth');
  const [loaded,     setLoaded]     = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; sent?: number; failed?: number; error?: string } | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: settings } = useQuery<Settings>({ queryKey: ['/api/settings'] });
  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery<WhatsappAlertLog[]>({
    queryKey: ['/api/whatsapp/logs'],
    refetchInterval: 30_000,
  });

  // Populate state once when settings arrive
  useEffect(() => {
    if (settings && !loaded) {
      setLoaded(true);
      setEnabled(settings.whatsappEnabled ?? false);
      setProvider((settings.whatsappProvider as 'callmebot' | 'ultramsg') ?? 'callmebot');
      setPhones(settings.whatsappPhones ?? '');
      setApiKey(settings.whatsappApiKey ?? '');
      setInstanceId(settings.whatsappInstanceId ?? '');
      setAlertTypes(settings.whatsappAlertTypes ?? 'fas,balance,traffic,outage,auth');
    }
  }, [settings, loaded]);

  // ── Toggle alert type in the CSV string ───────────────────────────────────
  function toggleAlertType(id: string) {
    const current = alertTypes.split(',').map(t => t.trim()).filter(Boolean);
    const next = current.includes(id)
      ? current.filter(t => t !== id)
      : [...current, id];
    setAlertTypes(next.join(','));
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/settings', {
      whatsappEnabled:    enabled,
      whatsappProvider:   provider,
      whatsappPhones:     phones,
      whatsappApiKey:     apiKey,
      whatsappInstanceId: instanceId,
      whatsappAlertTypes: alertTypes,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({ title: 'Saved', description: 'WhatsApp alert settings updated.' });
    },
    onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  const testMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/whatsapp/test'),
    onSuccess: (res: any) => {
      setTestResult(res);
      refetchLogs();
      if (res.ok) {
        toast({ title: 'Test sent!', description: `Delivered to ${res.sent} number(s).` });
      } else {
        toast({ title: 'Test failed', description: res.error ?? `Sent: ${res.sent}, Failed: ${res.failed}`, variant: 'destructive' });
      }
    },
    onError: (e: any) => {
      setTestResult({ ok: false, error: e.message });
      toast({ title: 'Test failed', description: e.message, variant: 'destructive' });
    },
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedTypes = alertTypes.split(',').map(t => t.trim()).filter(Boolean);
  const sentCount     = logs.filter(l => l.status === 'sent').length;
  const failedCount   = logs.filter(l => l.status === 'failed').length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <MessageSquare className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">WhatsApp Push Alerts</h1>
            <p className="text-sm text-muted-foreground">Send instant WhatsApp notifications for VoIP events to your team</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {enabled
              ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1.5"><Wifi className="h-3 w-3" /> Active</Badge>
              : <Badge variant="outline" className="text-muted-foreground gap-1.5"><WifiOff className="h-3 w-3" /> Disabled</Badge>
            }
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Sent',  value: sentCount,   color: 'text-emerald-400', Icon: CheckCircle2 },
            { label: 'Failed',      value: failedCount, color: 'text-rose-400',    Icon: XCircle      },
            { label: 'Log Entries', value: logs.length, color: 'text-primary',     Icon: Activity     },
          ].map(s => (
            <Card key={s.label} className="border-border/40">
              <CardContent className="p-4 flex items-center gap-3">
                <s.Icon className={`h-7 w-7 ${s.color} opacity-70`} />
                <div>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Configuration card */}
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Provider Configuration</CardTitle>
            <CardDescription className="text-xs">Choose a WhatsApp API provider and enter your credentials</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Enable toggle */}
            <div className="flex items-center justify-between rounded-lg border border-border/40 p-4">
              <div>
                <p className="text-sm font-semibold">Enable WhatsApp Alerts</p>
                <p className="text-xs text-muted-foreground">When disabled, no messages will be sent</p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                data-testid="toggle-whatsapp-enabled"
              />
            </div>

            {/* Provider */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provider</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as 'callmebot' | 'ultramsg')}>
                <SelectTrigger data-testid="select-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="callmebot">CallMeBot (Free — personal use)</SelectItem>
                  <SelectItem value="ultramsg">UltraMsg (Business — WhatsApp API)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Provider help */}
            {provider === 'callmebot' && (
              <div className="rounded-lg bg-sky-500/5 border border-sky-500/20 p-4 space-y-3">
                <p className="text-xs font-semibold text-sky-400 flex items-center gap-2">
                  <ExternalLink className="h-3.5 w-3.5" /> How to activate CallMeBot (free, one-time per number)
                </p>
                <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside leading-relaxed">
                  <li>
                    Tap the button below — it opens WhatsApp with the activation message pre-typed. Just hit <strong className="text-foreground/70">Send</strong>.
                    <div className="mt-2 not-italic">
                      <a
                        href="https://wa.me/34644597302?text=I%20allow%20callmebot%20to%20send%20me%20messages"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-500/25 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" /> Open WhatsApp to activate CallMeBot
                      </a>
                    </div>
                  </li>
                  <li>CallMeBot replies with your personal <strong className="text-foreground/70">API Key</strong> (a 6-digit number). Copy it.</li>
                  <li>Enter your phone number in E.164 format (e.g. <code className="bg-background px-1 rounded font-mono text-foreground/80">+923001234567</code>) and paste the API key in the fields below.</li>
                </ol>
                <p className="text-xs text-muted-foreground/60 border-t border-border/30 pt-2">
                  ⚠️ Each recipient must activate their own number individually before they can receive alerts.
                  If the link doesn't work, visit{' '}
                  <a href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noopener noreferrer" className="text-sky-400 underline underline-offset-2">callmebot.com</a>
                  {' '}for the latest setup instructions.
                </p>
              </div>
            )}
            {provider === 'ultramsg' && (
              <div className="rounded-lg bg-sky-500/5 border border-sky-500/20 p-4 space-y-2">
                <p className="text-xs font-semibold text-sky-400 flex items-center gap-2">
                  <ExternalLink className="h-3.5 w-3.5" /> How to set up UltraMsg
                </p>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Sign up at <strong className="text-foreground/70">ultramsg.com</strong> and create an instance</li>
                  <li>Connect a WhatsApp number to the instance (scan QR code)</li>
                  <li>Copy the <strong className="text-foreground/70">Instance ID</strong> and <strong className="text-foreground/70">Token</strong> from the dashboard</li>
                </ol>
              </div>
            )}

            {/* Phone numbers */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recipient Numbers (E.164, comma-separated)
              </Label>
              <Input
                value={phones}
                onChange={e => setPhones(e.target.value)}
                data-testid="input-phones"
                placeholder="+923001234567, +441234567890"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Include country code with + prefix. Each number will receive all alerts.</p>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {provider === 'callmebot' ? 'CallMeBot API Key' : 'UltraMsg Token'}
              </Label>
              <Input
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                data-testid="input-api-key"
                type="password"
                placeholder={provider === 'callmebot' ? '123456' : 'your-ultramsg-token'}
                className="font-mono text-sm"
              />
            </div>

            {/* Instance ID — UltraMsg only */}
            {provider === 'ultramsg' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">UltraMsg Instance ID</Label>
                <Input
                  value={instanceId}
                  onChange={e => setInstanceId(e.target.value)}
                  data-testid="input-instance-id"
                  placeholder="instance12345"
                  className="font-mono text-sm"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alert types card */}
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Alert Types</CardTitle>
            <CardDescription className="text-xs">Choose which events trigger a WhatsApp notification</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALERT_TYPES.map(at => {
                const checked = selectedTypes.includes(at.id);
                return (
                  <button
                    key={at.id}
                    type="button"
                    data-testid={`alert-type-${at.id}`}
                    onClick={() => toggleAlertType(at.id)}
                    className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                      checked
                        ? 'border-primary/50 bg-primary/5 text-foreground'
                        : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-border'
                    }`}
                  >
                    <Checkbox checked={checked} className="mt-0.5 pointer-events-none" />
                    <div>
                      <p className="text-xs font-semibold leading-none mb-0.5">{at.icon} {at.label}</p>
                      <p className="text-xs text-muted-foreground/70 leading-snug">{at.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Action bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate()}
            data-testid="button-test"
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {testMutation.isPending ? 'Sending…' : 'Send Test Message'}
          </Button>

          {testResult && (
            <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                : 'border-rose-500/30 bg-rose-500/5 text-rose-400'
            }`}>
              {testResult.ok
                ? <><CheckCircle2 className="h-3.5 w-3.5" /> Delivered to {testResult.sent} number(s)</>
                : <><XCircle className="h-3.5 w-3.5" /> {testResult.error ?? `Sent: ${testResult.sent}, Failed: ${testResult.failed}`}</>
              }
            </div>
          )}
        </div>

        {/* Delivery Log */}
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Delivery Log</CardTitle>
                <CardDescription className="text-xs">Last 200 WhatsApp alert delivery attempts</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => refetchLogs()} disabled={logsLoading} data-testid="button-refresh-logs">
                <RefreshCw className={`h-4 w-4 ${logsLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="text-center text-sm text-muted-foreground py-8">Loading…</div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">No alerts sent yet</p>
                <p className="text-xs text-muted-foreground/60">Once WhatsApp alerts are enabled and triggered, delivery records will appear here</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-muted-foreground">
                      <th className="text-left pb-2 pr-4 font-medium">Time</th>
                      <th className="text-left pb-2 pr-4 font-medium">Type</th>
                      <th className="text-left pb-2 pr-4 font-medium">Recipient</th>
                      <th className="text-left pb-2 pr-4 font-medium">Status</th>
                      <th className="text-left pb-2 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {logs.map(log => (
                      <tr key={log.id} className="hover:bg-muted/20" data-testid={`log-row-${log.id}`}>
                        <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap font-mono">
                          {log.sentAt ? new Date(log.sentAt).toLocaleString() : '—'}
                        </td>
                        <td className="py-2 pr-4 font-semibold whitespace-nowrap">
                          {alertTypeLabel(log.alertType)}
                        </td>
                        <td className="py-2 pr-4 font-mono text-muted-foreground">{log.recipient}</td>
                        <td className="py-2 pr-4">
                          <StatusBadge status={log.status} />
                        </td>
                        <td className="py-2 text-muted-foreground max-w-xs truncate">
                          {log.errorMsg
                            ? <span className="text-rose-400 text-xs">{log.errorMsg.slice(0, 80)}</span>
                            : <span className="text-emerald-400/70 text-xs">OK</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Security note */}
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-4 flex gap-3">
            <Shield className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-amber-400">Security Note</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                API keys and tokens are stored encrypted in the database. Never share your CallMeBot API key or UltraMsg token.
                For CallMeBot, each phone number must individually consent by messaging the bot before it can receive alerts.
              </p>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
