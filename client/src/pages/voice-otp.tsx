import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Phone, CheckCircle2, XCircle, Clock, RefreshCw, Send,
  Loader2, PhoneCall, WifiOff, AlertTriangle, Activity, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AmiStatus {
  connected:  boolean;
  latencyMs?: number;
  error?:     string;
}

interface VoiceOtpStats {
  callsToday:   number;
  successToday: number;
  failedToday:  number;
  pendingToday: number;
}

interface VoiceOtpCall {
  id:           number;
  toNumber:     string;
  otp:          string;
  trunk:        string;
  asteriskId?:  string;
  status:       string;
  errorMessage?: string;
  initiatedAt:  string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    initiated: { label: 'Initiating', cls: 'text-sky-400   border-sky-500/30   bg-sky-500/10'   },
    ringing:   { label: 'Ringing',    cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
    answered:  { label: 'Answered',   cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    completed: { label: 'Completed',  cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    failed:    { label: 'Failed',     cls: 'text-rose-400  border-rose-500/30  bg-rose-500/10'  },
  };
  const s = map[status] ?? { label: status, cls: 'text-muted-foreground border-border' };
  return <Badge variant="outline" className={cn("text-[10px] font-medium", s.cls)}>{s.label}</Badge>;
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-1">
      <p className={cn("text-2xl font-bold", color ?? "text-foreground")}>{value}</p>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
    </div>
  );
}

export default function VoiceOtpPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showSend, setShowSend] = useState(false);
  const [form, setForm] = useState({ to: '', otp: '', trunk: 'Sippy' });

  const { data: status } = useQuery<AmiStatus>({
    queryKey: ['/api/voice-otp/status'],
    refetchInterval: 30_000,
  });

  const { data: stats } = useQuery<VoiceOtpStats>({
    queryKey: ['/api/voice-otp/stats'],
    refetchInterval: 15_000,
  });

  const { data: calls = [], isLoading } = useQuery<VoiceOtpCall[]>({
    queryKey: ['/api/voice-otp/calls'],
    refetchInterval: 5_000,
  });

  const callMutation = useMutation({
    mutationFn: (body: typeof form) => apiRequest('POST', '/api/voice-otp', body),
    onSuccess: async (res: any) => {
      const data = await res.json?.() ?? res;
      if (data.ok) {
        toast({ title: 'Call Initiated', description: `OTP call to ${form.to} — ID #${data.callId}` });
        setForm(f => ({ ...f, to: '', otp: '' }));
        qc.invalidateQueries({ queryKey: ['/api/voice-otp/calls'] });
        qc.invalidateQueries({ queryKey: ['/api/voice-otp/stats'] });
      } else {
        toast({ title: 'Failed', description: data.error ?? 'Unknown error', variant: 'destructive' });
      }
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const connected       = status?.connected ?? false;
  const notConfigured   = status?.error?.includes('not set');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <Phone className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Voice OTP</h1>
              <p className="text-sm text-muted-foreground">
                Asterisk → Sippy → Carrier · {status?.latencyMs ? `AMI ${status.latencyMs}ms` : 'AMI ping pending'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border",
              notConfigured ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
              : connected    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              :                "bg-rose-500/10 border-rose-500/30 text-rose-400"
            )}>
              {notConfigured ? <AlertTriangle className="h-3 w-3" /> : connected ? <CheckCircle2 className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {notConfigured ? 'Not configured' : connected ? `Connected · 159.223.32.59:5038` : 'Disconnected'}
            </div>
            <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['/api/voice-otp/status'] })} data-testid="button-refresh-ami">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={() => setShowSend(v => !v)} data-testid="button-send-otp">
              <PhoneCall className="h-3.5 w-3.5 mr-1.5" />
              Send OTP Call
              <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", showSend && "rotate-180")} />
            </Button>
          </div>
        </div>

        {/* Not configured warning */}
        {notConfigured && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-400">AMI secret not configured</p>
              <p className="text-muted-foreground text-xs mt-1">
                Add <code className="bg-muted px-1 rounded">ASTERISK_AMI_SECRET</code> to Replit Secrets, then restart the server.
              </p>
            </div>
          </div>
        )}

        {/* Send panel */}
        {showSend && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-4">
            <p className="text-sm font-semibold flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-violet-400" /> Initiate OTP Call
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">To (number)</Label>
                <Input placeholder="+923001112233" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} data-testid="input-votp-to" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">OTP Digits (4–8)</Label>
                <Input placeholder="987432" maxLength={8} value={form.otp} onChange={e => setForm(f => ({ ...f, otp: e.target.value.replace(/\D/g,'') }))} data-testid="input-votp-otp" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Trunk</Label>
                <Input placeholder="Sippy" value={form.trunk} onChange={e => setForm(f => ({ ...f, trunk: e.target.value }))} data-testid="input-votp-trunk" />
              </div>
            </div>
            <Button
              size="sm"
              disabled={!form.to || !form.otp || callMutation.isPending}
              onClick={() => callMutation.mutate(form)}
              data-testid="button-votp-submit"
            >
              {callMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <Send className="h-3.5 w-3.5 mr-1.5" />}
              Initiate Call
            </Button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Calls Today"   value={stats.callsToday.toString()} />
            <StatCard label="Connected"     value={stats.successToday.toString()} color="text-emerald-400" />
            <StatCard label="Failed"        value={stats.failedToday.toString()}  color="text-rose-400" />
            <StatCard label="Pending"       value={stats.pendingToday.toString()} color="text-amber-400" />
          </div>
        )}

        {/* Call log */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-violet-400" />
            <p className="text-sm font-semibold">Call Log</p>
            {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
          </div>

          {!calls || calls.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <Phone className="h-8 w-8 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">No calls yet</p>
              <p className="text-xs text-muted-foreground/60">Use the Send OTP Call button to initiate a test call</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[480px] overflow-y-auto">
              {calls.map(call => (
                <div key={call.id} className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0" data-testid={`votp-call-${call.id}`}>
                  <div>
                    {call.status === 'completed' || call.status === 'answered'
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      : call.status === 'failed'
                      ? <XCircle className="h-4 w-4 text-rose-400" />
                      : <Clock className="h-4 w-4 text-amber-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-medium">{call.toNumber}</span>
                      <span className="text-[10px] text-muted-foreground">via {call.trunk}</span>
                      <StatusBadge status={call.status} />
                    </div>
                    {call.asteriskId && (
                      <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">ID: {call.asteriskId}</p>
                    )}
                    {call.errorMessage && (
                      <p className="text-[10px] text-rose-400 mt-0.5">{call.errorMessage}</p>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 whitespace-nowrap shrink-0">
                    {new Date(call.initiatedAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Architecture note */}
        <div className="rounded-xl border border-border/50 bg-muted/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Architecture</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400">BitsAuto</span>
            <span>→</span>
            <span className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400">Asterisk AMI · 159.223.32.59:5038</span>
            <span>→</span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">Sippy SIP trunk</span>
            <span>→</span>
            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">Carrier</span>
          </div>
        </div>

      </div>
    </div>
  );
}
