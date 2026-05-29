import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Plus, Trash2, Loader2, Settings2, ChevronDown, ChevronRight,
  Network, Server, Radio, Zap, GitBranch, Info, Play,
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

interface Chain {
  id: number;
  name: string;
  description?: string;
  reveProfileId?: number;
  asteriskTrunk: string;
  asteriskHost: string;
  sippyClientAccountId?: number;
  sippyVendorId?: number;
  sippyConnectionId?: number;
  sippyRoutingGroupId?: number;
  sippyClientName?: string;
  sippyVendorName?: string;
  sippyConnectionName?: string;
  isActive: boolean;
  notes?: string;
  createdAt: string;
}

interface ReveProfile { id: number; name: string; baseUrl: string }
interface SippyVendor { iVendor: number; name: string }
interface SippyAccount { iAccount: number; id?: string; username?: string }
interface SippyConnection { iConnection: number; name: string }
interface SippyRoutingGroup { iRoutingGroup: number; name: string }

interface ValidationHop {
  hop: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}

const EMPTY_FORM = {
  name: '', description: '', notes: '',
  reveProfileId: '', asteriskTrunk: 'Sippy', asteriskHost: '159.223.32.59',
  sippyClientAccountId: '', sippyClientName: '',
  sippyVendorId: '', sippyVendorName: '',
  sippyConnectionId: '', sippyConnectionName: '',
  sippyRoutingGroupId: '',
};

function HopIcon({ hop }: { hop: string }) {
  if (hop === 'REVE')             return <Radio className="h-3.5 w-3.5 text-sky-400" />;
  if (hop === 'Asterisk')        return <Server className="h-3.5 w-3.5 text-amber-400" />;
  if (hop.includes('Vendor'))    return <Network className="h-3.5 w-3.5 text-violet-400" />;
  if (hop.includes('Connection'))return <GitBranch className="h-3.5 w-3.5 text-emerald-400" />;
  return <Zap className="h-3.5 w-3.5 text-muted-foreground" />;
}

function StatusIcon({ status }: { status: 'ok' | 'warn' | 'error' }) {
  if (status === 'ok')   return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (status === 'warn') return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
  return <XCircle className="h-3.5 w-3.5 text-rose-400" />;
}

function ChainDiagram({ chain, profiles }: { chain: Chain; profiles: ReveProfile[] }) {
  const reve = profiles.find(p => p.id === chain.reveProfileId);
  const hops = [
    { label: 'REVE', value: reve?.name ?? 'Not linked', color: 'border-sky-500/40 bg-sky-500/5 text-sky-400', icon: <Radio className="h-4 w-4" /> },
    { label: 'BitsAuto', value: 'This system', color: 'border-indigo-500/40 bg-indigo-500/5 text-indigo-400', icon: <Zap className="h-4 w-4" /> },
    { label: 'Asterisk', value: `${chain.asteriskHost} / ${chain.asteriskTrunk}`, color: 'border-amber-500/40 bg-amber-500/5 text-amber-400', icon: <Server className="h-4 w-4" /> },
    { label: 'Sippy', value: chain.sippyVendorName ?? (chain.sippyVendorId ? `ID ${chain.sippyVendorId}` : 'Not linked'), color: 'border-violet-500/40 bg-violet-500/5 text-violet-400', icon: <Network className="h-4 w-4" /> },
    { label: 'Vendor Termination', value: chain.sippyConnectionName ?? (chain.sippyConnectionId ? `Conn ID ${chain.sippyConnectionId}` : 'Not linked'), color: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-400', icon: <GitBranch className="h-4 w-4" /> },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {hops.map((h, i) => (
        <div key={h.label} className="flex items-center gap-1">
          <div className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium", h.color)}>
            {h.icon}
            <div>
              <div className="text-[9px] opacity-60 uppercase tracking-wide leading-none mb-0.5">{h.label}</div>
              <div className="leading-none truncate max-w-[90px]">{h.value}</div>
            </div>
          </div>
          {i < hops.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        </div>
      ))}
    </div>
  );
}

function ValidationPanel({ chainId, onClose }: { chainId: number; onClose: () => void }) {
  const { data, isLoading, refetch } = useQuery<{ overall: string; hops: ValidationHop[] }>({
    queryKey: [`/api/termination/chains/${chainId}/validate`],
    queryFn: async () => {
      const res = await apiRequest('POST', `/api/termination/chains/${chainId}/validate`, {});
      return res.json();
    },
    enabled: true,
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 mt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold flex items-center gap-1.5"><Play className="h-3.5 w-3.5" />Validation Result</span>
        <div className="flex gap-1.5">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => refetch()}><RefreshCw className="h-3 w-3" /></Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}><XCircle className="h-3 w-3" /></Button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Probing each hop…
        </div>
      ) : data ? (
        <div className="space-y-2">
          {data.hops.map(h => (
            <div key={h.hop} className="flex items-start gap-2.5">
              <StatusIcon status={h.status} />
              <HopIcon hop={h.hop} />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium">{h.hop}</span>
                <p className="text-[10px] text-muted-foreground truncate">{h.detail}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function TerminationChainsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAddForm, setShowAddForm]         = useState(false);
  const [form, setForm]                       = useState(EMPTY_FORM);
  const [validatingId, setValidatingId]       = useState<number | null>(null);
  const [vendorConns, setVendorConns]         = useState<SippyConnection[]>([]);
  const [loadingConns, setLoadingConns]       = useState(false);

  const { data, isLoading } = useQuery<{ chains: Chain[]; profiles: ReveProfile[] }>({
    queryKey: ['/api/termination/chains'],
  });

  const { data: vendors } = useQuery<{ vendors: SippyVendor[] }>({
    queryKey: ['/api/termination/sippy/vendors'],
  });

  const { data: sippyAccounts } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ['/api/termination/sippy/accounts'],
  });

  const { data: routingGroups } = useQuery<{ routingGroups: SippyRoutingGroup[] }>({
    queryKey: ['/api/termination/sippy/routing-groups'],
  });

  async function fetchConnections(vendorId: string) {
    if (!vendorId) return;
    setLoadingConns(true);
    try {
      const res = await apiRequest('GET', `/api/termination/sippy/vendors/${vendorId}/connections`);
      const d = await res.json();
      setVendorConns(d.connections ?? []);
    } catch { setVendorConns([]); }
    finally { setLoadingConns(false); }
  }

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => apiRequest('POST', '/api/termination/chains', body),
    onSuccess: () => {
      toast({ title: 'Chain created' });
      setForm(EMPTY_FORM);
      setShowAddForm(false);
      setVendorConns([]);
      qc.invalidateQueries({ queryKey: ['/api/termination/chains'] });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/termination/chains/${id}`),
    onSuccess: () => { toast({ title: 'Chain deleted' }); qc.invalidateQueries({ queryKey: ['/api/termination/chains'] }); },
    onError:  (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest('PATCH', `/api/termination/chains/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/termination/chains'] }),
  });

  const chains   = data?.chains   ?? [];
  const profiles = data?.profiles ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <Network className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Termination Chains</h1>
              <p className="text-sm text-muted-foreground">End-to-end entity mapping: REVE → BitsAuto → Asterisk → Sippy → Vendor</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowAddForm(v => !v)} data-testid="button-add-chain">
            <Plus className="h-3.5 w-3.5 mr-1.5" />New Chain
          </Button>
        </div>

        {/* Architecture overview */}
        <div className="rounded-xl border border-border/50 bg-muted/5 p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current Architecture Gap</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
              <p className="font-medium text-amber-400 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />REVE → BitsAuto</p>
              <p className="text-muted-foreground">Client/Vendor mapping configured in REVE. BitsAuto receives via DLR push.</p>
            </div>
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-1">
              <p className="font-medium text-rose-400 flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5" />Asterisk → Sippy</p>
              <p className="text-muted-foreground">SIP trunk present but no client/vendor context. Calls arrive without entity tags.</p>
            </div>
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-1">
              <p className="font-medium text-rose-400 flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5" />Sippy Termination</p>
              <p className="text-muted-foreground">No vendor termination accounts configured. Traffic has nowhere to route.</p>
            </div>
          </div>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-5">
            <p className="text-sm font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4 text-violet-400" />Define Termination Chain</p>

            {/* Basic info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Chain Name *</Label>
                <Input placeholder="e.g. Pakistan OTP Flow" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-chain-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Input placeholder="Optional description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} data-testid="input-chain-desc" />
              </div>
            </div>

            {/* Layer 1: REVE */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-sky-400">
                <Radio className="h-3.5 w-3.5" /><span>Layer 1 — REVE</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">BhaooSMS HTTP Profile</Label>
                  <Select value={form.reveProfileId} onValueChange={v => setForm(f => ({ ...f, reveProfileId: v }))}>
                    <SelectTrigger data-testid="select-reve-profile"><SelectValue placeholder="Select profile…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {profiles.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Layer 2: Asterisk */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <Server className="h-3.5 w-3.5" /><span>Layer 2 — Asterisk (FreePBX)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Asterisk Host</Label>
                  <Input placeholder="159.223.32.59" value={form.asteriskHost} onChange={e => setForm(f => ({ ...f, asteriskHost: e.target.value }))} data-testid="input-asterisk-host" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Sippy Trunk Name (in Asterisk)</Label>
                  <Input placeholder="Sippy" value={form.asteriskTrunk} onChange={e => setForm(f => ({ ...f, asteriskTrunk: e.target.value }))} data-testid="input-asterisk-trunk" />
                </div>
              </div>
            </div>

            {/* Layer 3: Sippy Client Account */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-400">
                <Zap className="h-3.5 w-3.5" /><span>Layer 3 — Sippy Client Account (originating side)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Sippy Account</Label>
                  <Select
                    value={form.sippyClientAccountId}
                    onValueChange={v => {
                      const acct = sippyAccounts?.accounts?.find((a: any) => String(a.iAccount) === v);
                      setForm(f => ({ ...f, sippyClientAccountId: v, sippyClientName: acct ? (acct.id ?? acct.username ?? `Account ${v}`) : '' }));
                    }}
                  >
                    <SelectTrigger data-testid="select-sippy-account"><SelectValue placeholder="Select account…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {(sippyAccounts?.accounts ?? []).map((a: any) => (
                        <SelectItem key={a.iAccount} value={String(a.iAccount)}>
                          {a.id ?? a.username ?? `Account ${a.iAccount}`} (#{a.iAccount})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Display Name (auto-filled)</Label>
                  <Input value={form.sippyClientName} onChange={e => setForm(f => ({ ...f, sippyClientName: e.target.value }))} placeholder="e.g. OTP Client" data-testid="input-client-name" />
                </div>
              </div>
            </div>

            {/* Layer 4: Sippy Vendor */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
                <Network className="h-3.5 w-3.5" /><span>Layer 4 — Sippy Vendor (termination side)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Sippy Vendor</Label>
                  <Select
                    value={form.sippyVendorId}
                    onValueChange={v => {
                      const vend = vendors?.vendors?.find(vv => String(vv.iVendor) === v);
                      setForm(f => ({ ...f, sippyVendorId: v, sippyVendorName: vend?.name ?? '', sippyConnectionId: '', sippyConnectionName: '' }));
                      fetchConnections(v);
                    }}
                  >
                    <SelectTrigger data-testid="select-sippy-vendor"><SelectValue placeholder="Select vendor…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {(vendors?.vendors ?? []).map(v => (
                        <SelectItem key={v.iVendor} value={String(v.iVendor)}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Vendor Connection {loadingConns && <Loader2 className="inline h-3 w-3 animate-spin ml-1" />}</Label>
                  <Select
                    value={form.sippyConnectionId}
                    onValueChange={v => {
                      const conn = vendorConns.find(c => String(c.iConnection) === v);
                      setForm(f => ({ ...f, sippyConnectionId: v, sippyConnectionName: conn?.name ?? '' }));
                    }}
                    disabled={!form.sippyVendorId || loadingConns}
                  >
                    <SelectTrigger data-testid="select-sippy-connection"><SelectValue placeholder={form.sippyVendorId ? 'Select connection…' : 'Pick vendor first'} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {vendorConns.map(c => (
                        <SelectItem key={c.iConnection} value={String(c.iConnection)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Routing Group</Label>
                  <Select
                    value={form.sippyRoutingGroupId}
                    onValueChange={v => setForm(f => ({ ...f, sippyRoutingGroupId: v }))}
                  >
                    <SelectTrigger data-testid="select-routing-group"><SelectValue placeholder="Select group…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {(routingGroups?.routingGroups ?? []).map((rg: any) => (
                        <SelectItem key={rg.iRoutingGroup} value={String(rg.iRoutingGroup)}>{rg.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} placeholder="Any notes about this chain…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} data-testid="textarea-chain-notes" />
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!form.name || createMutation.isPending}
                onClick={() => createMutation.mutate(form)}
                data-testid="button-save-chain"
              >
                {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                Save Chain
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setShowAddForm(false); setForm(EMPTY_FORM); setVendorConns([]); }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Chain list */}
        {isLoading ? (
          <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-32 bg-card border border-border rounded-xl animate-pulse" />)}</div>
        ) : chains.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Network className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground font-medium">No chains defined yet</p>
            <p className="text-xs text-muted-foreground/60 max-w-md mx-auto">
              A termination chain maps entities across REVE, Asterisk, Sippy and your vendor so every SMS/call
              has consistent client/vendor attribution across all systems.
            </p>
            <Button size="sm" className="mt-2" onClick={() => setShowAddForm(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Create First Chain
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {chains.map(chain => (
              <ChainCard
                key={chain.id}
                chain={chain}
                profiles={profiles}
                validatingId={validatingId}
                setValidatingId={setValidatingId}
                onDelete={id => deleteMutation.mutate(id)}
                onToggle={(id, isActive) => toggleMutation.mutate({ id, isActive })}
              />
            ))}
          </div>
        )}

        {/* Setup guide */}
        <div className="rounded-xl border border-border/50 bg-muted/5 p-5 space-y-4">
          <p className="text-sm font-semibold flex items-center gap-2"><Info className="h-4 w-4 text-muted-foreground" />Sippy Vendor Termination — Setup Checklist</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-muted-foreground">
            <div className="space-y-2">
              <p className="font-medium text-foreground">In Sippy Admin</p>
              <ol className="space-y-1.5 list-decimal list-inside">
                <li>Vendors → Add Vendor → set name, tech prefix, capacity</li>
                <li>Vendors → Connections → Add Connection → enter carrier SIP host, port, auth</li>
                <li>Routing → Routing Groups → create group → add the connection</li>
                <li>Accounts → assign the routing group to the originating account</li>
                <li>Billing → add tariff to vendor and assign rate plan</li>
              </ol>
            </div>
            <div className="space-y-2">
              <p className="font-medium text-foreground">In Asterisk (FreePBX)</p>
              <ol className="space-y-1.5 list-decimal list-inside">
                <li>Connectivity → Trunks → verify "Sippy" trunk points to Sippy SBC IP</li>
                <li>Outbound Routes → "International" → match pattern <code className="bg-muted px-1 rounded">.</code></li>
                <li>SIP Settings → set Sippy SBC as outbound proxy if needed</li>
                <li>Apply Config after every change</li>
              </ol>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

function ChainCard({
  chain, profiles, validatingId, setValidatingId, onDelete, onToggle,
}: {
  chain: Chain;
  profiles: ReveProfile[];
  validatingId: number | null;
  setValidatingId: (id: number | null) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number, active: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("rounded-xl border p-5 space-y-3", chain.isActive ? "border-border bg-card" : "border-border/40 bg-muted/5 opacity-60")} data-testid={`chain-card-${chain.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full shrink-0", chain.isActive ? "bg-emerald-400" : "bg-muted-foreground")} />
            <span className="text-sm font-semibold">{chain.name}</span>
            {chain.description && <span className="text-xs text-muted-foreground">{chain.description}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs"
            onClick={() => setValidatingId(validatingId === chain.id ? null : chain.id)}
            data-testid={`button-validate-chain-${chain.id}`}
          >
            <Play className="h-3 w-3 mr-1" />Validate
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onToggle(chain.id, !chain.isActive)} data-testid={`button-toggle-chain-${chain.id}`}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-400 hover:text-rose-300" onClick={() => onDelete(chain.id)} data-testid={`button-delete-chain-${chain.id}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded(v => !v)}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <ChainDiagram chain={chain} profiles={profiles} />

      {validatingId === chain.id && (
        <ValidationPanel chainId={chain.id} onClose={() => setValidatingId(null)} />
      )}

      {expanded && (
        <div className="pt-2 border-t border-border/50 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
          <div><span className="text-muted-foreground block">Asterisk Host</span><span className="font-mono">{chain.asteriskHost}</span></div>
          <div><span className="text-muted-foreground block">Trunk</span><span className="font-mono">{chain.asteriskTrunk}</span></div>
          {chain.sippyClientAccountId && <div><span className="text-muted-foreground block">Sippy Account</span><span>{chain.sippyClientName ?? chain.sippyClientAccountId}</span></div>}
          {chain.sippyVendorId        && <div><span className="text-muted-foreground block">Sippy Vendor</span><span>{chain.sippyVendorName ?? chain.sippyVendorId}</span></div>}
          {chain.sippyConnectionId    && <div><span className="text-muted-foreground block">Connection</span><span>{chain.sippyConnectionName ?? chain.sippyConnectionId}</span></div>}
          {chain.sippyRoutingGroupId  && <div><span className="text-muted-foreground block">Routing Group</span><span>#{chain.sippyRoutingGroupId}</span></div>}
          {chain.notes && <div className="col-span-full"><span className="text-muted-foreground block">Notes</span><span>{chain.notes}</span></div>}
          <div><span className="text-muted-foreground block">Created</span><span>{new Date(chain.createdAt).toLocaleDateString()}</span></div>
        </div>
      )}
    </div>
  );
}
