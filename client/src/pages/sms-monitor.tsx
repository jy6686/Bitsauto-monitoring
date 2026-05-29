import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Clock, BarChart3, Send, Wallet, Activity, ChevronDown, Loader2,
  WifiOff, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Stats {
  sentToday:       number;
  deliveredToday:  number;
  failedToday:     number;
  pendingToday:    number;
  deliveryRate:    number;
  balance:         number;
  currency:        string;
  balanceError?:   string;
  operatorBreakdown: { operator: string; sent: number; delivered: number; rate: number }[];
}

interface SmsMessage {
  id:          number;
  internalId?: string;
  bhaooId?:   string;
  toNumber:    string;
  fromId?:     string;
  messageText?: string;
  status:      string;
  operator?:   string;
  country?:    string;
  errorMessage?: string;
  submittedAt: string;
  dlrReceivedAt?: string;
}

interface BhaooStatus {
  connected: boolean;
  balance?:  number;
  currency?: string;
  error?:    string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    delivered: { label: 'Delivered', cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    submitted: { label: 'Submitted', cls: 'text-sky-400 border-sky-500/30 bg-sky-500/10' },
    sent:      { label: 'Sent',      cls: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
    pending:   { label: 'Pending',   cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
    failed:    { label: 'Failed',    cls: 'text-rose-400 border-rose-500/30 bg-rose-500/10' },
    unknown:   { label: 'Unknown',   cls: 'text-muted-foreground border-border' },
  };
  const s = map[status] ?? map.unknown;
  return <Badge variant="outline" className={cn("text-[10px] font-medium", s.cls)}>{s.label}</Badge>;
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-1">
      <p className={cn("text-2xl font-bold", color ?? "text-foreground")}>{value}</p>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

export default function SmsMonitorPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showSendPanel, setShowSendPanel] = useState(false);
  const [sendForm, setSendForm] = useState({ to: '', from: 'BitsAuto', text: '', type: 'text' });

  const { data: status } = useQuery<BhaooStatus>({
    queryKey: ['/api/bhaoo/status'],
    refetchInterval: 60_000,
  });

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<Stats>({
    queryKey: ['/api/bhaoo/stats'],
    refetchInterval: 30_000,
  });

  const { data: messages, isLoading: msgsLoading } = useQuery<SmsMessage[]>({
    queryKey: ['/api/bhaoo/messages'],
    refetchInterval: 15_000,
  });

  const sendMutation = useMutation({
    mutationFn: (body: typeof sendForm) => apiRequest('POST', '/api/sms/send', body),
    onSuccess: async (res: any) => {
      const data = await res.json?.() ?? res;
      if (data.status === 0) {
        toast({ title: 'SMS Sent', description: `Message accepted — ID: ${data.messageId}` });
        setSendForm(f => ({ ...f, to: '', text: '' }));
        qc.invalidateQueries({ queryKey: ['/api/bhaoo/messages'] });
        qc.invalidateQueries({ queryKey: ['/api/bhaoo/stats'] });
      } else {
        toast({ title: 'Send Failed', description: data.error ?? 'Unknown error', variant: 'destructive' });
      }
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const connected   = status?.connected ?? false;
  const notConfigured = status?.error?.includes('not set');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20">
              <MessageSquare className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">SMS Monitor — BhaooSMS</h1>
              <p className="text-sm text-muted-foreground">REVE SMS V5 gateway · live delivery tracking · A2P operations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border",
              notConfigured ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
              : connected    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              :                "bg-rose-500/10 border-rose-500/30 text-rose-400"
            )}>
              {notConfigured ? <AlertTriangle className="h-3 w-3" /> : connected ? <CheckCircle2 className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {notConfigured ? 'Not configured' : connected ? 'Connected' : 'Disconnected'}
            </div>
            <Button size="sm" variant="outline" onClick={() => { refetchStats(); qc.invalidateQueries({ queryKey: ['/api/bhaoo/status'] }); }} data-testid="button-refresh-sms">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={() => setShowSendPanel(v => !v)} data-testid="button-send-sms">
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Send SMS
              <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", showSendPanel && "rotate-180")} />
            </Button>
          </div>
        </div>

        {/* Not configured warning */}
        {notConfigured && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-400">BhaooSMS credentials not configured</p>
              <p className="text-muted-foreground text-xs mt-1">Add <code className="bg-muted px-1 rounded">BHAOO_API_KEY</code> and <code className="bg-muted px-1 rounded">BHAOO_SECRET_KEY</code> to Replit Secrets, then restart the server.</p>
            </div>
          </div>
        )}

        {/* Send SMS panel */}
        {showSendPanel && (
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-5 space-y-4">
            <p className="text-sm font-semibold flex items-center gap-2"><Send className="h-4 w-4 text-sky-400" /> Send Test SMS</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">To (number)</Label>
                <Input placeholder="+923001112233" value={sendForm.to} onChange={e => setSendForm(f => ({ ...f, to: e.target.value }))} data-testid="input-sms-to" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">From (Sender ID)</Label>
                <Input placeholder="BitsAuto" value={sendForm.from} onChange={e => setSendForm(f => ({ ...f, from: e.target.value }))} data-testid="input-sms-from" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={sendForm.type} onValueChange={v => setSendForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger data-testid="select-sms-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="unicode">Unicode</SelectItem>
                    <SelectItem value="flash">Flash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea placeholder="Your message here..." value={sendForm.text} onChange={e => setSendForm(f => ({ ...f, text: e.target.value }))} rows={2} data-testid="textarea-sms-message" />
            </div>
            <Button
              size="sm"
              disabled={!sendForm.to || !sendForm.text || sendMutation.isPending}
              onClick={() => sendMutation.mutate(sendForm)}
              data-testid="button-send-sms-submit"
            >
              {sendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              Send
            </Button>
          </div>
        )}

        {/* Stats grid */}
        {statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 h-20 animate-pulse" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <StatCard label="Sent Today"     value={stats.sentToday.toLocaleString()}      color="text-foreground" />
            <StatCard label="Delivered"       value={stats.deliveredToday.toLocaleString()} color="text-emerald-400" />
            <StatCard label="Failed"          value={stats.failedToday.toLocaleString()}    color="text-rose-400" />
            <StatCard label="Pending"         value={stats.pendingToday.toLocaleString()}   color="text-amber-400" />
            <StatCard
              label="Delivery Rate"
              value={`${stats.deliveryRate}%`}
              color={stats.deliveryRate >= 95 ? 'text-emerald-400' : stats.deliveryRate >= 80 ? 'text-amber-400' : 'text-rose-400'}
            />
            <StatCard
              label="Balance"
              value={stats.balanceError ? '—' : `${stats.currency ?? 'USD'} ${stats.balance?.toFixed(2) ?? '0.00'}`}
              color={stats.balanceError ? 'text-muted-foreground' : (stats.balance ?? 0) < 10 ? 'text-rose-400' : 'text-sky-400'}
              sub={stats.balanceError ? 'API error' : undefined}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Operator breakdown */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-400" />
              <p className="text-sm font-semibold">Operator Breakdown</p>
              <span className="text-[10px] text-muted-foreground ml-auto">Last 24h</span>
            </div>
            {!stats || stats.operatorBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No operator data yet</p>
            ) : (
              <div className="space-y-3">
                {stats.operatorBreakdown.map(op => (
                  <div key={op.operator} className="space-y-1" data-testid={`operator-row-${op.operator}`}>
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{op.operator}</span>
                      <span className={cn("font-mono", op.rate >= 95 ? 'text-emerald-400' : op.rate >= 80 ? 'text-amber-400' : 'text-rose-400')}>{op.rate}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", op.rate >= 95 ? 'bg-emerald-500' : op.rate >= 80 ? 'bg-amber-500' : 'bg-rose-500')}
                          style={{ width: `${op.rate}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-20 text-right">{op.delivered}/{op.sent}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Message log */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-sky-400" />
              <p className="text-sm font-semibold">Recent Messages</p>
              {msgsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
            </div>

            {!messages || messages.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">No messages yet</p>
                <p className="text-xs text-muted-foreground/60">Send a test SMS or wait for incoming DLR events</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {messages.map(msg => (
                  <div key={msg.id} className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0" data-testid={`sms-message-${msg.id}`}>
                    <div className="mt-0.5">
                      {msg.status === 'delivered' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        : msg.status === 'failed'  ? <XCircle className="h-4 w-4 text-rose-400" />
                        : <Clock className="h-4 w-4 text-amber-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-medium">{msg.toNumber}</span>
                        {msg.operator && <span className="text-[10px] text-muted-foreground">{msg.operator}</span>}
                        {msg.country  && <span className="text-[10px] text-muted-foreground">{msg.country}</span>}
                        <StatusBadge status={msg.status} />
                      </div>
                      {msg.messageText && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{msg.messageText}</p>
                      )}
                      {msg.errorMessage && (
                        <p className="text-[10px] text-rose-400 mt-0.5">{msg.errorMessage}</p>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 whitespace-nowrap shrink-0">
                      {new Date(msg.submittedAt).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Balance alert */}
        {stats && !stats.balanceError && (stats.balance ?? 0) < 10 && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 flex items-start gap-3">
            <Wallet className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-rose-400">Low balance alert</p>
              <p className="text-muted-foreground text-xs mt-1">
                Account balance is {stats.currency} {stats.balance?.toFixed(2)} — top up via BhaooSMS dashboard or use the Recharge API.
              </p>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border/50 bg-muted/5 p-3 flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-[11px] text-muted-foreground">
            DLR push endpoint: <code className="bg-muted px-1 rounded font-mono">POST /api/bhaoo/dlr</code> — configure this URL in your BhaooSMS HTTP profile to receive live delivery reports.
          </p>
        </div>

      </div>
    </div>
  );
}
