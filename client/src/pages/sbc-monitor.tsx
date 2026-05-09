import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Network, Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Activity, Cpu, Layers, Radio, Wifi, Settings, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface SbcHost {
  id: number;
  name: string;
  host: string;
  port: number;
  vendor: string;
  enabled: boolean;
  lastStatus: string;
  lastCheckedAt: string | null;
  createdAt: string;
}

interface SbcMetrics {
  activeSessions: number;
  cpuPercent: number;
  transcodingLoad: number;
  registrations: number;
  mediaBypassRate: number;
  optionsResponseMs: number;
}

const SBC_VENDORS = ['kamailio', 'opensips', 'sonus', 'audiocodes', 'ribbon', 'generic'];

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'ok':       return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case 'degraded': return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case 'down':     return <XCircle className="h-4 w-4 text-rose-400" />;
    default:         return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
  }
}

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SbcCard({ host }: { host: SbcHost }) {
  const { data: metrics, isLoading, refetch } = useQuery<SbcMetrics>({
    queryKey: ['/api/sbc-hosts', host.id, 'metrics'],
    staleTime: 30000,
    refetchInterval: 60000,
    enabled: host.enabled,
  });

  const statusColor = host.lastStatus === 'ok' ? 'border-emerald-500/30' : host.lastStatus === 'degraded' ? 'border-amber-500/30' : host.lastStatus === 'down' ? 'border-rose-500/30' : 'border-border';

  return (
    <div className={cn("bg-card border rounded-xl p-5 space-y-4 transition-colors", statusColor)}>
      <div className="flex items-start gap-3">
        <StatusIcon status={host.lastStatus} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{host.name}</p>
          <p className="text-xs font-mono text-muted-foreground">{host.host}:{host.port}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] capitalize">{host.vendor}</Badge>
          <button onClick={() => refetch()} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {host.enabled && (
        isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {[1,2,3].map(i => <div key={i} className="h-12 rounded-lg bg-muted/20 animate-pulse" />)}
          </div>
        ) : metrics ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Sessions", value: metrics.activeSessions, unit: "" },
                { label: "CPU", value: `${metrics.cpuPercent}%`, unit: "" },
                { label: "OPTIONS", value: `${metrics.optionsResponseMs}ms`, unit: "" },
              ].map(m => (
                <div key={m.label} className="bg-muted/20 rounded-lg px-3 py-2 text-center">
                  <p className="text-base font-bold">{m.value}</p>
                  <p className="text-[10px] text-muted-foreground">{m.label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><Cpu className="h-3 w-3" /> CPU</span>
                <span>{metrics.cpuPercent}%</span>
              </div>
              <MetricBar value={metrics.cpuPercent} max={100} color={metrics.cpuPercent > 80 ? 'bg-rose-500' : metrics.cpuPercent > 60 ? 'bg-amber-500' : 'bg-emerald-500'} />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> Transcoding</span>
                <span>{metrics.transcodingLoad}%</span>
              </div>
              <MetricBar value={metrics.transcodingLoad} max={100} color={metrics.transcodingLoad > 70 ? 'bg-rose-500' : 'bg-cyan-500'} />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><Wifi className="h-3 w-3" /> Media Bypass</span>
                <span className="text-emerald-400">{metrics.mediaBypassRate}%</span>
              </div>
              <MetricBar value={metrics.mediaBypassRate} max={100} color="bg-emerald-500" />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
              <span className="flex items-center gap-1"><Radio className="h-3 w-3" /> {metrics.registrations} registrations</span>
              {host.lastCheckedAt && <span>Checked {new Date(host.lastCheckedAt).toLocaleTimeString()}</span>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <AlertTriangle className="h-3.5 w-3.5" />
            Could not retrieve metrics — check connectivity and API config
          </div>
        )
      )}
    </div>
  );
}

export default function SbcMonitorPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ name: '', host: '', port: 5060, vendor: 'generic', apiUrl: '', apiKey: '', snmpCommunity: 'public' });

  const { data: hosts = [], isLoading } = useQuery<SbcHost[]>({
    queryKey: ['/api/sbc-hosts'],
    staleTime: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => apiRequest('POST', '/api/sbc-hosts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/sbc-hosts'] });
      setShowDialog(false);
      toast({ title: "SBC host added", description: form.name });
      setForm({ name: '', host: '', port: 5060, vendor: 'generic', apiUrl: '', apiKey: '', snmpCommunity: 'public' });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/sbc-hosts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/sbc-hosts'] }),
  });

  const okCount = hosts.filter(h => h.lastStatus === 'ok').length;
  const downCount = hosts.filter(h => h.lastStatus === 'down').length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
              <Network className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">SBC / Media Plane Monitor</h1>
              <p className="text-sm text-muted-foreground">Session Border Controller health, media sessions, transcoding and registration storms</p>
            </div>
          </div>
          <Button onClick={() => setShowDialog(true)} data-testid="button-add-sbc">
            <Plus className="h-4 w-4 mr-2" /> Add SBC Host
          </Button>
        </div>

        {hosts.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total Hosts", value: hosts.length, color: "text-foreground" },
              { label: "Healthy", value: okCount, color: "text-emerald-400" },
              { label: "Down", value: downCount, color: downCount > 0 ? "text-rose-400" : "text-muted-foreground" },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-xl p-4 text-center">
                <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-blue-300">SBC Integration</p>
            <p>Metrics are polled via REST API or SNMP depending on the SBC vendor. Configure the API URL and key (or SNMP community) for each host. SIP OPTIONS probing works for any vendor.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1,2].map(i => <div key={i} className="h-48 rounded-xl bg-muted/20 animate-pulse" />)}
          </div>
        ) : hosts.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-cyan-500/5 border border-cyan-500/20 flex items-center justify-center">
              <Network className="h-7 w-7 text-cyan-400/50" />
            </div>
            <p className="text-sm text-muted-foreground">No SBC hosts configured yet.</p>
            <p className="text-xs text-muted-foreground/60">Add your Session Border Controllers to monitor media plane health.</p>
            <Button size="sm" variant="outline" onClick={() => setShowDialog(true)}>Add First SBC</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hosts.map(h => <SbcCard key={h.id} host={h} />)}
          </div>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add SBC Host</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Display Name</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Primary SBC — AMS" data-testid="input-sbc-name" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Host / IP</label>
                <Input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="192.168.1.1" data-testid="input-sbc-host" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">SIP Port</label>
                <Input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Vendor</label>
              <Select value={form.vendor} onValueChange={v => setForm(f => ({ ...f, vendor: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SBC_VENDORS.map(v => <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">API URL (optional — for REST metrics)</label>
              <Input value={form.apiUrl} onChange={e => setForm(f => ({ ...f, apiUrl: e.target.value }))} placeholder="https://sbc:8080/api" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">API Key</label>
                <Input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} placeholder="optional" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">SNMP Community</label>
                <Input value={form.snmpCommunity} onChange={e => setForm(f => ({ ...f, snmpCommunity: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(form)} disabled={!form.name || !form.host || createMutation.isPending} data-testid="button-save-sbc">
              Add Host
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
