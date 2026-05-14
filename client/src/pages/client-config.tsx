import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  UserCog, Mail, Network, ShieldCheck, Server, FileText, ShieldAlert,
  Search, Loader2, ChevronDown, X, Plus, Trash2, Building2, Check,
  AlertCircle, Settings2
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { id: 'update',        label: 'Client Update',    icon: UserCog,     desc: 'Status, credit limit & session limits' },
  { id: 'email',         label: 'Email',            icon: Mail,        desc: 'Notification & invoice email settings'  },
  { id: 'trunks',        label: 'Trunk Update',     icon: Network,     desc: 'Routing group & trunk parameters'       },
  { id: 'auth',          label: 'Authentication',   icon: ShieldCheck, desc: 'IP auth rules & protocol settings'      },
  { id: 'technical',     label: 'Technical Config', icon: Server,      desc: 'Codec, relay & SIP registration'        },
  { id: 'ratesheet',     label: 'Rate Sheet Config',icon: FileText,    desc: 'Invoice & rate sheet format settings'   },
  { id: 'rules',         label: 'Rules Update',     icon: ShieldAlert, desc: 'Validation rules & prefix policies'     },
  { id: 'email-format',  label: 'Email Format',     icon: Mail,        desc: 'Email template & branding settings'     },
] as const;

type TabId = typeof TABS[number]['id'];

interface SippyAccount {
  i_account: number;
  username: string;
  balance?: number;
  blocked?: number;
  i_customer?: number;
}

function AccountSelector({
  accounts, loading, selectedId, onSelect,
}: { accounts: SippyAccount[]; loading: boolean; selectedId: number | null; onSelect: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = accounts.find(a => a.i_account === selectedId);
  const filtered = accounts.filter(a =>
    !q || a.username?.toLowerCase().includes(q.toLowerCase()) || String(a.i_account).includes(q)
  ).slice(0, 40);

  return (
    <div className="relative">
      <button
        data-testid="account-selector-btn"
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm w-full min-w-[280px] bg-background hover:bg-muted/50 transition-colors",
          open ? "border-primary ring-1 ring-primary/30" : "border-border"
        )}
      >
        <Building2 className="h-4 w-4 text-amber-400 flex-shrink-0" />
        {selected ? (
          <span className="flex-1 text-left font-medium truncate">
            {selected.username}
            <span className="ml-2 text-xs text-muted-foreground">#{selected.i_account}</span>
          </span>
        ) : (
          <span className="flex-1 text-left text-muted-foreground">Select a client account…</span>
        )}
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-full min-w-[320px] bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <input
              autoFocus
              data-testid="account-search-input"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/60"
              placeholder="Search username or account ID…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            {q && <button onClick={() => setQ('')}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">No accounts found</div>
            ) : filtered.map(a => (
              <button
                key={a.i_account}
                type="button"
                data-testid={`account-option-${a.i_account}`}
                onClick={() => { onSelect(a.i_account); setOpen(false); setQ(''); }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors text-left",
                  a.i_account === selectedId && "bg-primary/10"
                )}
              >
                <Building2 className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                <span className="flex-1 truncate font-medium">{a.username}</span>
                <span className="text-xs text-muted-foreground">#{a.i_account}</span>
                {a.blocked === 1 && <Badge variant="destructive" className="text-[10px] py-0 px-1">Blocked</Badge>}
                {a.i_account === selectedId && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TabClientUpdate({ iAccount }: { iAccount: number }) {
  const { toast } = useToast();
  const { data: info, isLoading } = useQuery<any>({ queryKey: [`/api/sippy/accounts/${iAccount}/info`], staleTime: 30_000 });
  const [form, setForm] = useState({ blocked: false, creditLimit: '', maxSessions: '', maxCallsPerSecond: '', maxSessionTime: '' });
  const [initialised, setInitialised] = useState(false);

  if (info && !initialised) {
    setInitialised(true);
    setForm({
      blocked: info.blocked === 1,
      creditLimit: info.credit_limit !== undefined ? String(info.credit_limit) : '',
      maxSessions: info.max_sessions !== undefined ? String(info.max_sessions) : '',
      maxCallsPerSecond: info.max_calls_per_second !== undefined ? String(info.max_calls_per_second) : '',
      maxSessionTime: info.max_session_time !== undefined ? String(info.max_session_time) : '',
    });
  }

  const mutation = useMutation({
    mutationFn: (payload: any) => apiRequest('PATCH', `/api/sippy/accounts/${iAccount}/settings`, payload),
    onSuccess: () => { toast({ title: 'Client updated', description: 'Settings saved successfully.' }); queryClient.invalidateQueries({ queryKey: [`/api/sippy/accounts/${iAccount}/info`] }); },
    onError: (e: any) => toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  const handleSubmit = () => {
    const payload: any = {};
    if (form.blocked !== undefined) payload.blocked = form.blocked;
    if (form.maxSessions)       payload.maxSessions       = Number(form.maxSessions);
    if (form.maxCallsPerSecond) payload.maxCallsPerSecond = Number(form.maxCallsPerSecond);
    if (form.maxSessionTime)    payload.maxSessionTime    = Number(form.maxSessionTime);
    mutation.mutate(payload);
    if (form.creditLimit) {
      apiRequest('PATCH', `/api/sippy/accounts/${iAccount}/credit-limit`, { creditLimit: Number(form.creditLimit) });
    }
  };

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading account data…</div>;

  return (
    <div className="space-y-6 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 flex items-center justify-between p-4 rounded-lg border border-border bg-muted/20">
          <div><p className="text-sm font-medium">Account Status</p><p className="text-xs text-muted-foreground">Block or unblock this account on the switch</p></div>
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-medium", form.blocked ? "text-rose-400" : "text-emerald-400")}>{form.blocked ? 'Blocked' : 'Active'}</span>
            <Switch data-testid="toggle-blocked" checked={!form.blocked} onCheckedChange={v => setForm(f => ({ ...f, blocked: !v }))} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="creditLimit">Credit Limit ($)</Label>
          <Input data-testid="input-credit-limit" id="creditLimit" type="number" placeholder="e.g. 500" value={form.creditLimit} onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxSessions">Max Concurrent Sessions</Label>
          <Input data-testid="input-max-sessions" id="maxSessions" type="number" placeholder="e.g. 10" value={form.maxSessions} onChange={e => setForm(f => ({ ...f, maxSessions: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxCps">Max Calls Per Second</Label>
          <Input data-testid="input-max-cps" id="maxCps" type="number" placeholder="e.g. 2" value={form.maxCallsPerSecond} onChange={e => setForm(f => ({ ...f, maxCallsPerSecond: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxSessionTime">Max Session Time (sec)</Label>
          <Input data-testid="input-max-session-time" id="maxSessionTime" type="number" placeholder="e.g. 3600" value={form.maxSessionTime} onChange={e => setForm(f => ({ ...f, maxSessionTime: e.target.value }))} />
        </div>
      </div>
      <Button data-testid="btn-save-client-update" onClick={handleSubmit} disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}Save Changes
      </Button>
    </div>
  );
}

function TabEmail({ iAccount }: { iAccount: number }) {
  const { toast } = useToast();
  const { data: cfg, isLoading } = useQuery<any>({ queryKey: [`/api/account-configs/${iAccount}`], staleTime: 60_000 });
  const [form, setForm] = useState({ notificationEmail: '', ccEmails: '', lowBalanceThreshold: '', invoiceEmail: '' });
  const [initialised, setInitialised] = useState(false);
  if (cfg && !initialised) { setInitialised(true); setForm({ notificationEmail: cfg.email?.notificationEmail ?? '', ccEmails: cfg.email?.ccEmails ?? '', lowBalanceThreshold: cfg.email?.lowBalanceThreshold ?? '', invoiceEmail: cfg.email?.invoiceEmail ?? '' }); }

  const mutation = useMutation({
    mutationFn: () => apiRequest('PUT', `/api/account-configs/${iAccount}`, { section: 'email', data: form }),
    onSuccess: () => { toast({ title: 'Email settings saved' }); queryClient.invalidateQueries({ queryKey: [`/api/account-configs/${iAccount}`] }); },
    onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="space-y-1.5">
        <Label htmlFor="notifEmail">Primary Notification Email</Label>
        <Input data-testid="input-notif-email" id="notifEmail" type="email" placeholder="billing@client.com" value={form.notificationEmail} onChange={e => setForm(f => ({ ...f, notificationEmail: e.target.value }))} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ccEmails">CC Emails <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
        <Input data-testid="input-cc-emails" id="ccEmails" placeholder="finance@client.com, cto@client.com" value={form.ccEmails} onChange={e => setForm(f => ({ ...f, ccEmails: e.target.value }))} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invoiceEmail">Invoice Email</Label>
        <Input data-testid="input-invoice-email" id="invoiceEmail" type="email" placeholder="accounts@client.com" value={form.invoiceEmail} onChange={e => setForm(f => ({ ...f, invoiceEmail: e.target.value }))} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="threshold">Low Balance Alert Threshold ($)</Label>
        <Input data-testid="input-threshold" id="threshold" type="number" placeholder="e.g. 50" value={form.lowBalanceThreshold} onChange={e => setForm(f => ({ ...f, lowBalanceThreshold: e.target.value }))} />
      </div>
      <Button data-testid="btn-save-email" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}Save Email Settings
      </Button>
    </div>
  );
}

function TabTrunks({ iAccount }: { iAccount: number }) {
  const { toast } = useToast();
  const { data: info, isLoading } = useQuery<any>({ queryKey: [`/api/sippy/accounts/${iAccount}/info`], staleTime: 30_000 });
  const { data: rgs } = useQuery<any[]>({ queryKey: ['/api/routing-cache/groups'], staleTime: 120_000 });
  const [form, setForm] = useState({ iRoutingGroup: '', maxSessions: '', maxCallsPerSecond: '', maxSessionTime: '' });
  const [initialised, setInitialised] = useState(false);

  if (info && !initialised) {
    setInitialised(true);
    setForm({ iRoutingGroup: info.i_routing_group ? String(info.i_routing_group) : '', maxSessions: info.max_sessions !== undefined ? String(info.max_sessions) : '', maxCallsPerSecond: info.max_calls_per_second !== undefined ? String(info.max_calls_per_second) : '', maxSessionTime: info.max_session_time !== undefined ? String(info.max_session_time) : '' });
  }

  const mutation = useMutation({
    mutationFn: (payload: any) => apiRequest('PATCH', `/api/sippy/accounts/${iAccount}/settings`, payload),
    onSuccess: () => { toast({ title: 'Trunk settings saved' }); queryClient.invalidateQueries({ queryKey: [`/api/sippy/accounts/${iAccount}/info`] }); },
    onError: (e: any) => toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  const routingGroups = Array.isArray(rgs) ? rgs : [];

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="space-y-1.5">
        <Label>Routing Group</Label>
        <Select value={form.iRoutingGroup} onValueChange={v => setForm(f => ({ ...f, iRoutingGroup: v }))}>
          <SelectTrigger data-testid="select-routing-group"><SelectValue placeholder="Select routing group…" /></SelectTrigger>
          <SelectContent>
            {routingGroups.map((rg: any) => (
              <SelectItem key={rg.i_routing_group ?? rg.id} value={String(rg.i_routing_group ?? rg.id)}>
                {rg.name ?? rg.routing_group_name ?? rg.i_routing_group}
              </SelectItem>
            ))}
            {routingGroups.length === 0 && <SelectItem value="_none" disabled>No routing groups loaded</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="trunk-maxSessions">Max Sessions</Label>
          <Input data-testid="input-trunk-max-sessions" id="trunk-maxSessions" type="number" placeholder="e.g. 10" value={form.maxSessions} onChange={e => setForm(f => ({ ...f, maxSessions: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trunk-cps">Max CPS</Label>
          <Input data-testid="input-trunk-cps" id="trunk-cps" type="number" placeholder="e.g. 2" value={form.maxCallsPerSecond} onChange={e => setForm(f => ({ ...f, maxCallsPerSecond: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trunk-time">Max Call Time (s)</Label>
          <Input data-testid="input-trunk-call-time" id="trunk-time" type="number" placeholder="e.g. 3600" value={form.maxSessionTime} onChange={e => setForm(f => ({ ...f, maxSessionTime: e.target.value }))} />
        </div>
      </div>
      <Button data-testid="btn-save-trunks" onClick={() => mutation.mutate({ maxSessions: form.maxSessions ? Number(form.maxSessions) : undefined, maxCallsPerSecond: form.maxCallsPerSecond ? Number(form.maxCallsPerSecond) : undefined, maxSessionTime: form.maxSessionTime ? Number(form.maxSessionTime) : undefined })} disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}Save Trunk Settings
      </Button>
    </div>
  );
}

function TabAuth({ iAccount }: { iAccount: number }) {
  const { toast } = useToast();
  const { data: rulesData, isLoading } = useQuery<{ authRules: any[] }>({ queryKey: [`/api/sippy/accounts/${iAccount}/auth-rules`], staleTime: 30_000 });
  const [addForm, setAddForm] = useState({ remoteIp: '', iProtocol: '1', techPrefix: '' });

  const addMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/sippy/accounts/${iAccount}/auth-rules`, { iProtocol: Number(addForm.iProtocol), remoteIp: addForm.remoteIp || undefined, incomingCli: addForm.techPrefix || undefined }),
    onSuccess: () => { toast({ title: 'Auth rule added' }); queryClient.invalidateQueries({ queryKey: [`/api/sippy/accounts/${iAccount}/auth-rules`] }); setAddForm({ remoteIp: '', iProtocol: '1', techPrefix: '' }); },
    onError: (e: any) => toast({ title: 'Add failed', description: e.message, variant: 'destructive' }),
  });

  const rules = rulesData?.authRules ?? [];
  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading auth rules…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Existing Auth Rules</h3>
        {rules.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">No auth rules configured for this account</div>
        ) : (
          <div className="space-y-2">
            {rules.map((r: any, i: number) => (
              <div key={r.i_authentication ?? i} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-muted/20 text-sm">
                <ShieldCheck className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                <span className="flex-1"><span className="font-mono text-xs">{r.remote_ip ?? r.incoming_cli ?? r.from_domain ?? '—'}</span></span>
                <Badge variant="outline" className="text-xs">{r.protocol_name ?? `Protocol ${r.i_protocol}`}</Badge>
                {r.i_authentication && <span className="text-xs text-muted-foreground">#{r.i_authentication}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <Separator />
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Add New Auth Rule</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Remote IP</Label>
            <Input data-testid="input-auth-ip" placeholder="192.168.1.100" value={addForm.remoteIp} onChange={e => setAddForm(f => ({ ...f, remoteIp: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Protocol</Label>
            <Select value={addForm.iProtocol} onValueChange={v => setAddForm(f => ({ ...f, iProtocol: v }))}>
              <SelectTrigger data-testid="select-auth-protocol"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">SIP (1)</SelectItem>
                <SelectItem value="4">H.323 (4)</SelectItem>
                <SelectItem value="5">Skype (5)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tech Prefix / CLI</Label>
            <Input data-testid="input-auth-cli" placeholder="optional" value={addForm.techPrefix} onChange={e => setAddForm(f => ({ ...f, techPrefix: e.target.value }))} />
          </div>
        </div>
        <Button data-testid="btn-add-auth-rule" className="mt-3" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || (!addForm.remoteIp && !addForm.techPrefix)}>
          {addMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
          <Plus className="h-3.5 w-3.5 mr-1.5" />Add Rule
        </Button>
      </div>
    </div>
  );
}

function TabTechnical({ iAccount }: { iAccount: number }) {
  const { toast } = useToast();
  const { data: cfg, isLoading } = useQuery<any>({ queryKey: [`/api/account-configs/${iAccount}`], staleTime: 60_000 });
  const [form, setForm] = useState({ codec: 'g711', relayType: 'always', cldTranslationRule: '', cliTranslationRule: '', registrationExpiry: '3600', loopPrevention: false });
  const [initialised, setInitialised] = useState(false);
  if (cfg && !initialised) { setInitialised(true); if (cfg.technical) setForm({ ...form, ...cfg.technical }); }

  const mutation = useMutation({
    mutationFn: () => apiRequest('PUT', `/api/account-configs/${iAccount}`, { section: 'technical', data: form }),
    onSuccess: () => { toast({ title: 'Technical config saved' }); queryClient.invalidateQueries({ queryKey: [`/api/account-configs/${iAccount}`] }); },
    onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Preferred Codec</Label>
          <Select value={form.codec} onValueChange={v => setForm(f => ({ ...f, codec: v }))}>
            <SelectTrigger data-testid="select-codec"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="g711">G.711 (PCMU/PCMA)</SelectItem>
              <SelectItem value="g729">G.729</SelectItem>
              <SelectItem value="g722">G.722 HD</SelectItem>
              <SelectItem value="opus">Opus</SelectItem>
              <SelectItem value="any">Any (no preference)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>RTP Relay</Label>
          <Select value={form.relayType} onValueChange={v => setForm(f => ({ ...f, relayType: v }))}>
            <SelectTrigger data-testid="select-relay"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="always">Always</SelectItem>
              <SelectItem value="never">Never</SelectItem>
              <SelectItem value="on_nat">On NAT Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cldTranslation">CLD Translation Rule</Label>
          <Input data-testid="input-cld-rule" id="cldTranslation" placeholder="e.g. s/^00/+/" value={form.cldTranslationRule} onChange={e => setForm(f => ({ ...f, cldTranslationRule: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cliTranslation">CLI Translation Rule</Label>
          <Input data-testid="input-cli-rule" id="cliTranslation" placeholder="e.g. s/^0/+44/" value={form.cliTranslationRule} onChange={e => setForm(f => ({ ...f, cliTranslationRule: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="regExpiry">SIP Registration Expiry (sec)</Label>
          <Input data-testid="input-reg-expiry" id="regExpiry" type="number" value={form.registrationExpiry} onChange={e => setForm(f => ({ ...f, registrationExpiry: e.target.value }))} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
          <div><p className="text-sm font-medium">Loop Prevention</p><p className="text-xs text-muted-foreground">Reject re-entry calls</p></div>
          <Switch data-testid="toggle-loop-prevention" checked={form.loopPrevention} onCheckedChange={v => setForm(f => ({ ...f, loopPrevention: v }))} />
        </div>
      </div>
      <Button data-testid="btn-save-technical" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}Save Technical Config
      </Button>
    </div>
  );
}

function TabRateSheet({ iAccount }: { iAccount: number }) {
  const { toast } = useToast();
  const { data: cfg, isLoading } = useQuery<any>({ queryKey: [`/api/account-configs/${iAccount}`], staleTime: 60_000 });
  const [form, setForm] = useState({ currency: 'USD', rateFormat: 'per_min', dialcodeFormat: 'e164', prefixStyle: 'full', invoiceTemplate: 'standard', billingCycle: 'monthly' });
  const [initialised, setInitialised] = useState(false);
  if (cfg && !initialised) { setInitialised(true); if (cfg.ratesheet) setForm({ ...form, ...cfg.ratesheet }); }

  const mutation = useMutation({
    mutationFn: () => apiRequest('PUT', `/api/account-configs/${iAccount}`, { section: 'ratesheet', data: form }),
    onSuccess: () => { toast({ title: 'Rate sheet config saved' }); queryClient.invalidateQueries({ queryKey: [`/api/account-configs/${iAccount}`] }); },
    onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Currency</Label>
          <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
            <SelectTrigger data-testid="select-currency"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD ($)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="GBP">GBP (£)</SelectItem>
              <SelectItem value="AED">AED (د.إ)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Rate Format</Label>
          <Select value={form.rateFormat} onValueChange={v => setForm(f => ({ ...f, rateFormat: v }))}>
            <SelectTrigger data-testid="select-rate-format"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="per_min">Per Minute</SelectItem>
              <SelectItem value="per_sec">Per Second</SelectItem>
              <SelectItem value="per_call">Per Call</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Dialcode Format</Label>
          <Select value={form.dialcodeFormat} onValueChange={v => setForm(f => ({ ...f, dialcodeFormat: v }))}>
            <SelectTrigger data-testid="select-dialcode-format"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="e164">E.164 (+prefix)</SelectItem>
              <SelectItem value="national">National (no +)</SelectItem>
              <SelectItem value="raw">Raw digits</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Prefix Style</Label>
          <Select value={form.prefixStyle} onValueChange={v => setForm(f => ({ ...f, prefixStyle: v }))}>
            <SelectTrigger data-testid="select-prefix-style"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full prefix</SelectItem>
              <SelectItem value="short">Short (4-digit)</SelectItem>
              <SelectItem value="country">Country code only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Invoice Template</Label>
          <Select value={form.invoiceTemplate} onValueChange={v => setForm(f => ({ ...f, invoiceTemplate: v }))}>
            <SelectTrigger data-testid="select-invoice-template"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="detailed">Detailed (itemised)</SelectItem>
              <SelectItem value="summary">Summary only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Billing Cycle</Label>
          <Select value={form.billingCycle} onValueChange={v => setForm(f => ({ ...f, billingCycle: v }))}>
            <SelectTrigger data-testid="select-billing-cycle"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="prepaid">Prepaid only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button data-testid="btn-save-ratesheet" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}Save Rate Sheet Config
      </Button>
    </div>
  );
}

function TabRules({ iAccount }: { iAccount: number }) {
  const { toast } = useToast();
  const { data: cfg, isLoading } = useQuery<any>({ queryKey: [`/api/account-configs/${iAccount}`], staleTime: 60_000 });
  const [form, setForm] = useState({ cliFormat: 'e164', cldPrefix: '', minCallDuration: '0', maxCallDuration: '7200', blockedPrefixes: '', requireCli: false, rejectPrivateCli: false });
  const [initialised, setInitialised] = useState(false);
  if (cfg && !initialised) { setInitialised(true); if (cfg.rules) setForm({ ...form, ...cfg.rules }); }

  const mutation = useMutation({
    mutationFn: () => apiRequest('PUT', `/api/account-configs/${iAccount}`, { section: 'rules', data: form }),
    onSuccess: () => { toast({ title: 'Rules updated' }); queryClient.invalidateQueries({ queryKey: [`/api/account-configs/${iAccount}`] }); },
    onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>CLI Format Required</Label>
          <Select value={form.cliFormat} onValueChange={v => setForm(f => ({ ...f, cliFormat: v }))}>
            <SelectTrigger data-testid="select-cli-format"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="e164">E.164 (+XX…)</SelectItem>
              <SelectItem value="national">National</SelectItem>
              <SelectItem value="any">Any</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cldPrefix">Required CLD Prefix</Label>
          <Input data-testid="input-cld-prefix" id="cldPrefix" placeholder="e.g. +44" value={form.cldPrefix} onChange={e => setForm(f => ({ ...f, cldPrefix: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="minDuration">Min Call Duration (sec)</Label>
          <Input data-testid="input-min-duration" id="minDuration" type="number" value={form.minCallDuration} onChange={e => setForm(f => ({ ...f, minCallDuration: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxDuration">Max Call Duration (sec)</Label>
          <Input data-testid="input-max-duration" id="maxDuration" type="number" value={form.maxCallDuration} onChange={e => setForm(f => ({ ...f, maxCallDuration: e.target.value }))} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="blockedPrefixes">Blocked Destination Prefixes <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
          <Input data-testid="input-blocked-prefixes" id="blockedPrefixes" placeholder="+906, +9005, +7" value={form.blockedPrefixes} onChange={e => setForm(f => ({ ...f, blockedPrefixes: e.target.value }))} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
          <div><p className="text-sm font-medium">Require CLI</p><p className="text-xs text-muted-foreground">Reject calls without caller ID</p></div>
          <Switch data-testid="toggle-require-cli" checked={form.requireCli} onCheckedChange={v => setForm(f => ({ ...f, requireCli: v }))} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
          <div><p className="text-sm font-medium">Block Private CLI</p><p className="text-xs text-muted-foreground">Reject anonymous/private CLI</p></div>
          <Switch data-testid="toggle-reject-private" checked={form.rejectPrivateCli} onCheckedChange={v => setForm(f => ({ ...f, rejectPrivateCli: v }))} />
        </div>
      </div>
      <Button data-testid="btn-save-rules" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}Save Rules
      </Button>
    </div>
  );
}

function TabEmailFormat({ iAccount }: { iAccount: number }) {
  const { toast } = useToast();
  const { data: cfg, isLoading } = useQuery<any>({ queryKey: [`/api/account-configs/${iAccount}`], staleTime: 60_000 });
  const [form, setForm] = useState({ language: 'en', fromName: 'Bitsauto NOC', replyTo: '', signature: '', headerNote: '', footerNote: '', includeUsageGraph: false, includeCdrAttachment: false });
  const [initialised, setInitialised] = useState(false);
  if (cfg && !initialised) { setInitialised(true); if (cfg.emailFormat) setForm({ ...form, ...cfg.emailFormat }); }

  const mutation = useMutation({
    mutationFn: () => apiRequest('PUT', `/api/account-configs/${iAccount}`, { section: 'emailFormat', data: form }),
    onSuccess: () => { toast({ title: 'Email format saved' }); queryClient.invalidateQueries({ queryKey: [`/api/account-configs/${iAccount}`] }); },
    onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Language</Label>
          <Select value={form.language} onValueChange={v => setForm(f => ({ ...f, language: v }))}>
            <SelectTrigger data-testid="select-language"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ar">Arabic</SelectItem>
              <SelectItem value="fr">French</SelectItem>
              <SelectItem value="es">Spanish</SelectItem>
              <SelectItem value="de">German</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fromName">From Name</Label>
          <Input data-testid="input-from-name" id="fromName" placeholder="Bitsauto NOC" value={form.fromName} onChange={e => setForm(f => ({ ...f, fromName: e.target.value }))} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="replyTo">Reply-To Email</Label>
          <Input data-testid="input-reply-to" id="replyTo" type="email" placeholder="noc@bitsauto.com" value={form.replyTo} onChange={e => setForm(f => ({ ...f, replyTo: e.target.value }))} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="signature">Email Signature</Label>
          <Textarea data-testid="input-signature" id="signature" placeholder="Best regards, Bitsauto NOC Team…" rows={3} value={form.signature} onChange={e => setForm(f => ({ ...f, signature: e.target.value }))} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="headerNote">Header Note</Label>
          <Input data-testid="input-header-note" id="headerNote" placeholder="Optional note at top of email" value={form.headerNote} onChange={e => setForm(f => ({ ...f, headerNote: e.target.value }))} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="footerNote">Footer Note</Label>
          <Input data-testid="input-footer-note" id="footerNote" placeholder="Optional disclaimer at bottom" value={form.footerNote} onChange={e => setForm(f => ({ ...f, footerNote: e.target.value }))} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
          <div><p className="text-sm font-medium">Include Usage Graph</p><p className="text-xs text-muted-foreground">Attach usage chart image</p></div>
          <Switch data-testid="toggle-usage-graph" checked={form.includeUsageGraph} onCheckedChange={v => setForm(f => ({ ...f, includeUsageGraph: v }))} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
          <div><p className="text-sm font-medium">Include CDR Attachment</p><p className="text-xs text-muted-foreground">Attach CSV CDR to invoice email</p></div>
          <Switch data-testid="toggle-cdr-attach" checked={form.includeCdrAttachment} onCheckedChange={v => setForm(f => ({ ...f, includeCdrAttachment: v }))} />
        </div>
      </div>
      <Button data-testid="btn-save-email-format" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}Save Email Format
      </Button>
    </div>
  );
}

export default function ClientConfigPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search || '');
  const activeTab = (params.get('tab') ?? 'update') as TabId;
  const selectedId = params.get('id') ? parseInt(params.get('id')!, 10) : null;

  const navigate = (tab: string, id?: number | null) => {
    const p = new URLSearchParams();
    p.set('tab', tab);
    if (id) p.set('id', String(id));
    setLocation(`/client/config?${p.toString()}`);
  };

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ['/api/sippy/accounts'],
    staleTime: 60_000,
  });

  const accounts = accountsData?.accounts ?? [];
  const selectedAccount = accounts.find(a => a.i_account === selectedId);

  const activeTabDef = TABS.find(t => t.id === activeTab) ?? TABS[0];

  return (
    <LayoutShell>
      <div className="flex flex-col h-full min-h-0">
        {/* ── Header ── */}
        <div className="flex-shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-amber-400" />
                Client Configuration
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">Configure settings for an existing Sippy client account</p>
            </div>
            <AccountSelector
              accounts={accounts}
              loading={accountsLoading}
              selectedId={selectedId}
              onSelect={id => navigate(activeTab, id)}
            />
          </div>

          {/* ── Tab bar ── */}
          <div className="flex gap-0.5 mt-4 overflow-x-auto pb-0.5">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  data-testid={`tab-${tab.id}`}
                  onClick={() => navigate(tab.id, selectedId)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
                    isActive
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <div className="h-14 w-14 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Building2 className="h-7 w-7 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Select a client account</p>
                <p className="text-xs text-muted-foreground mt-1">Use the account selector above to choose which client to configure</p>
              </div>
              {accountsLoading && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading accounts…</p>}
            </div>
          ) : (
            <div>
              {/* Account info strip */}
              {selectedAccount && (
                <div className="flex items-center gap-3 mb-6 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                  <Building2 className="h-4 w-4 text-amber-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm">{selectedAccount.username}</span>
                    <span className="ml-2 text-xs text-muted-foreground">Account #{selectedAccount.i_account}</span>
                  </div>
                  {selectedAccount.balance !== undefined && (
                    <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/30">
                      ${Number(selectedAccount.balance).toFixed(2)}
                    </Badge>
                  )}
                  {selectedAccount.blocked === 1 && <Badge variant="destructive" className="text-xs">Blocked</Badge>}
                  <div className="text-xs text-muted-foreground border-l border-border pl-3">
                    <activeTabDef.icon className="h-3.5 w-3.5 inline mr-1.5 text-muted-foreground" />
                    {activeTabDef.desc}
                  </div>
                </div>
              )}

              {/* Tab content */}
              {activeTab === 'update'       && <TabClientUpdate  iAccount={selectedId} />}
              {activeTab === 'email'        && <TabEmail         iAccount={selectedId} />}
              {activeTab === 'trunks'       && <TabTrunks        iAccount={selectedId} />}
              {activeTab === 'auth'         && <TabAuth          iAccount={selectedId} />}
              {activeTab === 'technical'    && <TabTechnical     iAccount={selectedId} />}
              {activeTab === 'ratesheet'    && <TabRateSheet     iAccount={selectedId} />}
              {activeTab === 'rules'        && <TabRules         iAccount={selectedId} />}
              {activeTab === 'email-format' && <TabEmailFormat   iAccount={selectedId} />}
            </div>
          )}
        </div>
      </div>
    </LayoutShell>
  );
}
