import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Plus, Pencil, Trash2, Loader2, Building2, Server, X, Check,
  Globe, RefreshCw, Download, AlertTriangle, Send, Upload,
  Clock, CalendarClock, CheckCircle2, XCircle, Activity,
  ChevronUp, ChevronDown, Eye, EyeOff,
  Wifi, WifiOff, Shield, DollarSign, ShieldCheck, Info, Save,
  Network, Cable, ArrowRightLeft, Settings2,
} from "lucide-react";
import { Link } from "wouter";
import type { ClientProfile } from "@shared/schema";

interface VosClient {
  id: string;
  name: string;
  balance: number;
  status: string;
  type: string;
}

const TYPE_META = {
  client: {
    label: "Client",
    icon: Building2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    desc: "Sends calls to you — you bill them",
  },
  vendor: {
    label: "Vendor",
    icon: Server,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/30",
    desc: "You send calls to them — they bill you",
  },
};

const empty: Partial<ClientProfile> = {
  name: '', type: 'client', prefix: '', ipAddress: '',
  ratePerMin: 0.025, notes: '',
  rateEffectiveFrom: null, rateEffectiveTo: null,
};

function toLocalDT(utcStr: string | null | undefined): string {
  if (!utcStr) return '';
  try { return new Date(utcStr).toISOString().slice(0, 16); }
  catch { return ''; }
}

function fromLocalDT(val: string): string | null {
  if (!val) return null;
  return new Date(val + ':00Z').toISOString();
}

function fmtUTC(val: string | null | undefined): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleString('en-GB', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC';
  } catch { return val; }
}

function resolveSyncStatus(ss: Record<string, string> | null | undefined): { status?: string; syncedAt?: string } {
  if (!ss) return {};
  const syncedAt = ss.syncedAt;
  const statusKeys = Object.keys(ss).filter(k => k !== 'syncedAt');
  if (statusKeys.length === 0) return { syncedAt };
  // Prefer a 'synced' entry; if any key is synced, show synced. Otherwise show the first failure.
  const synced = statusKeys.find(k => ss[k] === 'synced');
  if (synced) return { status: 'synced', syncedAt };
  return { status: ss[statusKeys[0]], syncedAt };
}

function SyncBadge({ status, syncedAt }: { status?: string; syncedAt?: string }) {
  if (!status) return (
    <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">Not synced</span>
  );
  const ok = status === 'synced';
  const errorReason = !ok && status.startsWith('failed: ') ? status.slice('failed: '.length) : (!ok ? status : '');
  const tooltipText = ok
    ? (syncedAt ? `Last sync: ${fmtUTC(syncedAt)}` : 'Synced')
    : [syncedAt ? `Last sync: ${fmtUTC(syncedAt)}` : '', errorReason].filter(Boolean).join('\n');
  return (
    <span title={tooltipText || undefined}
      className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded cursor-help ${
        ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
      }`}>
      {ok ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
      {ok ? 'Synced' : 'Sync failed'}
    </span>
  );
}

const CODECS = ['', 'G.711u', 'G.711a', 'G.729', 'G.722', 'G.723', 'G.726', 'iLBC', 'Opus'];

function SippyAdvancedFields({ form, set }: { form: Partial<ClientProfile>; set: (k: keyof ClientProfile, v: any) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sm:col-span-2">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
      >
        <Server className="w-3 h-3" />
        Softswitch Parameters (VOS3000 / Sippy)
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <span className="text-muted-foreground/40">— codec, sessions, translation rules, routing…</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border border-border/50 bg-muted/10">

          {/* ── Basic Parameters ───────────────────────────────── */}
          <div className="sm:col-span-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">Basic Parameters</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Company Name</label>
            <input
              data-testid="input-profile-company-name"
              value={(form as any).companyName || ''}
              onChange={e => set('companyName' as any, e.target.value)}
              placeholder="e.g. Astra Global Ltd"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Timezone</label>
            <input
              data-testid="input-profile-timezone"
              value={(form as any).timezone || ''}
              onChange={e => set('timezone' as any, e.target.value)}
              placeholder="Etc/UTC"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Routing Group</label>
            <input
              data-testid="input-profile-routing-group"
              value={(form as any).routingGroup || ''}
              onChange={e => set('routingGroup' as any, e.target.value)}
              placeholder="e.g. Banglades IGW OR"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">SIP Class</label>
            <input
              data-testid="input-profile-sip-class"
              value={(form as any).sipClass || ''}
              onChange={e => set('sipClass' as any, e.target.value)}
              placeholder="e.g. 404 & 500 sip CC to"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* ── Rating & Billing ───────────────────────────────── */}
          <div className="sm:col-span-2 mt-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">Rating &amp; Billing</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Service Plan</label>
            <input
              data-testid="input-profile-service-plan"
              value={(form as any).servicePlan || ''}
              onChange={e => set('servicePlan' as any, e.target.value)}
              placeholder="e.g. astra-global (USD)"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Credit Limit</label>
            <input
              data-testid="input-profile-credit-limit"
              type="number" step="0.01" min="0"
              value={(form as any).creditLimit ?? ''}
              onChange={e => set('creditLimit' as any, e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="500.00"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* ── Advanced Parameters ────────────────────────────── */}
          <div className="sm:col-span-2 mt-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">Advanced Parameters</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Max Sessions</label>
            <input
              data-testid="input-profile-max-sessions"
              type="number" min="1"
              value={(form as any).maxSessions ?? ''}
              onChange={e => set('maxSessions' as any, e.target.value ? parseInt(e.target.value) : null)}
              placeholder="1000"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Max Calls / Second (CPS)</label>
            <input
              data-testid="input-profile-max-cps"
              type="number" min="1"
              value={(form as any).maxCallsPerSecond ?? ''}
              onChange={e => set('maxCallsPerSecond' as any, e.target.value ? parseInt(e.target.value) : null)}
              placeholder="45"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Max Session Time (sec)</label>
            <input
              data-testid="input-profile-max-session-time"
              type="number" min="60"
              value={(form as any).maxSessionTime ?? ''}
              onChange={e => set('maxSessionTime' as any, e.target.value ? parseInt(e.target.value) : null)}
              placeholder="7200"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Preferred Codec</label>
            <select
              data-testid="select-profile-codec"
              value={(form as any).preferredCodec || ''}
              onChange={e => set('preferredCodec' as any, e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              {CODECS.map(c => <option key={c} value={c}>{c || '— Default —'}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              CLD Translation Rule
            </label>
            <input
              data-testid="input-profile-cld-rule"
              value={(form as any).cldTranslationRule || ''}
              onChange={e => set('cldTranslationRule' as any, e.target.value)}
              placeholder="e.g. s/^6043//"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-muted-foreground">Applied to the destination number (CLD)</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              CLI Translation Rule
            </label>
            <input
              data-testid="input-profile-cli-rule"
              value={(form as any).cliTranslationRule || ''}
              onChange={e => set('cliTranslationRule' as any, e.target.value)}
              placeholder="e.g. s/^[+]//"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-muted-foreground">Applied to the caller ID (CLI)</p>
          </div>

        </div>
      )}
    </div>
  );
}

function ProfileForm({
  initial, onSave, onCancel, isSaving,
}: {
  initial: Partial<ClientProfile>;
  onSave: (data: Partial<ClientProfile>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<Partial<ClientProfile>>(initial);
  const set = (k: keyof ClientProfile, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 bg-muted/20 rounded-xl border border-border/50">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name *</label>
        <input
          data-testid="input-profile-name"
          value={form.name || ''}
          onChange={e => set('name', e.target.value)}
          placeholder="e.g. Acme Telecom"
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Type *</label>
        <select
          data-testid="select-profile-type"
          value={form.type || 'client'}
          onChange={e => set('type', e.target.value)}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        >
          <option value="client">Client (they send calls to you)</option>
          <option value="vendor">Vendor (you send calls to them)</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {form.type === 'vendor' ? 'CLD Prefix (Destination)' : 'CLI Prefix (Caller)'}
        </label>
        <input
          data-testid="input-profile-prefix"
          value={form.prefix || ''}
          onChange={e => set('prefix', e.target.value)}
          placeholder={form.type === 'vendor' ? 'e.g. +44 or +1212' : 'e.g. +1800 or +61'}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        <p className="text-xs text-muted-foreground">
          Calls whose {form.type === 'vendor' ? 'destination (CLD)' : 'originator (CLI)'} starts with this prefix will be matched to this {form.type}.
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rate / min (USD)</label>
        <input
          data-testid="input-profile-rate"
          type="number" step="0.0001" min="0"
          value={form.ratePerMin ?? 0.025}
          onChange={e => set('ratePerMin', parseFloat(e.target.value))}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <CalendarClock className="w-3 h-3" />
          Rate Effective From (UTC+00)
        </label>
        <input
          data-testid="input-rate-effective-from"
          type="datetime-local"
          value={toLocalDT(form.rateEffectiveFrom as any)}
          onChange={e => set('rateEffectiveFrom', fromLocalDT(e.target.value) as any)}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        <p className="text-xs text-muted-foreground">Date &amp; time the rate becomes active (leave blank = immediate)</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          Rate Expiry / Effective To (UTC+00)
        </label>
        <input
          data-testid="input-rate-effective-to"
          type="datetime-local"
          value={toLocalDT(form.rateEffectiveTo as any)}
          onChange={e => set('rateEffectiveTo', fromLocalDT(e.target.value) as any)}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        <p className="text-xs text-muted-foreground">Date &amp; time the rate expires (leave blank = no expiry)</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">IP Address</label>
        <input
          data-testid="input-profile-ip"
          value={form.ipAddress || ''}
          onChange={e => set('ipAddress', e.target.value)}
          placeholder="e.g. 45.59.163.182 or 10.0.0.0/24"
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        <p className="text-xs text-muted-foreground">
          Calls originating from this IP will be matched to this {form.type || 'profile'}.
          Supports exact IP or CIDR range.
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notes</label>
        <input
          data-testid="input-profile-notes"
          value={form.notes || ''}
          onChange={e => set('notes', e.target.value)}
          placeholder="Optional notes about this party…"
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>

      {/* Alert Email & Rate Overrides */}
      <div className="border border-border/50 rounded-lg p-4 space-y-3 bg-muted/20">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <span>Alert &amp; Rate Settings</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Alert Email (optional)</label>
            <input
              data-testid="input-alert-email"
              type="email"
              value={(form as any).alertEmail || ''}
              onChange={e => set('alertEmail' as any, e.target.value)}
              placeholder="client@example.com"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-[10px] text-muted-foreground/60">Receives balance &amp; FAS alerts for this party</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {(form.type === 'client') ? 'Revenue Rate ($/min)' : 'Cost Rate ($/min)'}
            </label>
            <input
              data-testid="input-rate-override"
              type="number"
              min={0} step={0.0001}
              value={form.type === 'client' ? ((form as any).revenuePerMin ?? '') : ((form as any).costPerMin ?? '')}
              onChange={e => {
                const val = e.target.value === '' ? null : Number(e.target.value);
                if (form.type === 'client') set('revenuePerMin' as any, val);
                else set('costPerMin' as any, val);
              }}
              placeholder="0.0250"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
            />
            <p className="text-[10px] text-muted-foreground/60">Manual rate override (Sippy rates used if blank)</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Base Rate ($/min)</label>
            <input
              data-testid="input-base-rate"
              type="number"
              min={0} step={0.0001}
              value={form.ratePerMin ?? 0.025}
              onChange={e => set('ratePerMin', Number(e.target.value))}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Sippy Advanced Parameters */}
      <SippyAdvancedFields form={form} set={set} />

      <div className="sm:col-span-2 flex gap-3 pt-1">
        <button
          data-testid="button-save-profile"
          onClick={() => onSave(form)}
          disabled={isSaving || !form.name}
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Save
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-2 px-5 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Send Rate Panel ────────────────────────────────────────────────────────────

type SwitchOption = { id: number; name: string; type: string; enabled: boolean };

function SendRatePanel({ profiles }: { profiles: ClientProfile[] }) {
  const queryClient = useQueryClient();
  const [partyType, setPartyType] = useState<'client' | 'vendor'>('client');
  const [profileId, setProfileId] = useState<string>('');
  const [prefix, setPrefix] = useState('');
  const [ratePerMin, setRatePerMin] = useState('0.0250');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [format, setFormat] = useState<'default' | 'partial' | 'full'>('default');
  const [result, setResult] = useState<{ success: boolean; message: string; detail?: string; results?: Record<string, any>; switchCount?: number } | null>(null);
  const [selectedSwitchIds, setSelectedSwitchIds] = useState<number[]>([]);

  const { data: extraSwitches = [] } = useQuery<SwitchOption[]>({ queryKey: ['/api/switches'] });
  const enabledSwitches = extraSwitches.filter(s => s.enabled);

  const filtered = profiles.filter(p => p.type === partyType);
  const selected = filtered.find(p => String(p.id) === profileId);

  function toggleSwitch(id: number) {
    setSelectedSwitchIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function selectProfile(id: string) {
    setProfileId(id);
    const p = filtered.find(x => String(x.id) === id);
    if (p) {
      if (p.prefix) setPrefix(p.prefix);
      if (p.ratePerMin) setRatePerMin(String(p.ratePerMin));
      if (p.rateEffectiveFrom) setEffectiveFrom(toLocalDT(p.rateEffectiveFrom as any));
      if (p.rateEffectiveTo) setEffectiveTo(toLocalDT(p.rateEffectiveTo as any));
    }
  }

  const pushMut = useMutation({
    mutationFn: () => apiRequest('POST', '/api/portal/push-rate', {
      profileId: profileId ? Number(profileId) : undefined,
      accountName: selected?.name || '',
      prefix,
      ratePerMin: parseFloat(ratePerMin),
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom + ':00Z').toISOString() : undefined,
      effectiveTo:   effectiveTo   ? new Date(effectiveTo   + ':00Z').toISOString() : undefined,
      format,
      switchIds: selectedSwitchIds.length > 0 ? selectedSwitchIds : undefined,
    }),
    onSuccess: (data: any) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
    },
    onError: (err: any) => setResult({ success: false, message: err.message }),
  });

  const syncMut = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/clients/${id}/sync`, {
      switchIds: selectedSwitchIds.length > 0 ? selectedSwitchIds : undefined,
    }),
    onSuccess: (data: any) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
    },
    onError: (err: any) => setResult({ success: false, message: err.message }),
  });

  const canSend = selected && prefix.trim() && parseFloat(ratePerMin) >= 0;

  return (
    <div className="space-y-6">
      {/* Party type toggle */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Select Party Type</p>
        <div className="flex gap-2">
          {(['client', 'vendor'] as const).map(t => (
            <button
              key={t}
              data-testid={`btn-party-type-${t}`}
              onClick={() => { setPartyType(t); setProfileId(''); setResult(null); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold border transition-all ${
                partyType === t
                  ? t === 'client'
                    ? 'bg-emerald-500 border-emerald-500 text-white shadow-md'
                    : 'bg-blue-500 border-blue-500 text-white shadow-md'
                  : 'border-border text-muted-foreground hover:bg-muted/40'
              }`}
            >
              {partyType === t && <Check className="w-3.5 h-3.5" />}
              {t === 'client' ? <Building2 className="w-3.5 h-3.5" /> : <Server className="w-3.5 h-3.5" />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Profile select */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            {partyType === 'client' ? 'Client' : 'Carrier / Vendor'} *
          </p>
          <select
            data-testid="select-send-rate-profile"
            value={profileId}
            onChange={e => selectProfile(e.target.value)}
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            <option value="">— Select {partyType} —</option>
            {filtered.map(p => (
              <option key={p.id} value={String(p.id)}>{p.name}</option>
            ))}
          </select>
          {filtered.length === 0 && (
            <p className="text-xs text-amber-400 mt-1">
              No {partyType}s configured yet. Add one in the <strong>Profiles</strong> tab first.
            </p>
          )}
        </div>

        {/* Format */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Format</p>
          <div className="flex gap-2">
            {(['default', 'partial', 'full'] as const).map(f => (
              <button
                key={f}
                data-testid={`btn-format-${f}`}
                onClick={() => setFormat(f)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                  format === f
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/40'
                }`}
              >
                {format === f && <span className="mr-1">✓</span>}
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Destination / Prefix */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Destination Prefix *</p>
          <input
            data-testid="input-send-rate-prefix"
            value={prefix}
            onChange={e => setPrefix(e.target.value)}
            placeholder="e.g. +1 or +44 or +8660"
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">
            E.164 prefix or exact number. Use <code className="text-violet-400">+</code> prefix for international.
          </p>
        </div>

        {/* Rate */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Rate / min (USD) *</p>
          <input
            data-testid="input-send-rate-rate"
            type="number" step="0.0001" min="0"
            value={ratePerMin}
            onChange={e => setRatePerMin(e.target.value)}
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        {/* Effective From */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <CalendarClock className="w-3 h-3" />
            Rate Effective From (GMT+00)
          </p>
          <input
            data-testid="input-send-effective-from"
            type="datetime-local"
            value={effectiveFrom}
            onChange={e => setEffectiveFrom(e.target.value)}
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">All times are UTC+00. Leave blank for immediate.</p>
        </div>

        {/* Effective To */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Rate Expiry / Effective To (GMT+00)
          </p>
          <input
            data-testid="input-send-effective-to"
            type="datetime-local"
            value={effectiveTo}
            onChange={e => setEffectiveTo(e.target.value)}
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">Leave blank = no expiry.</p>
        </div>
      </div>

      {/* Selected profile summary */}
      {selected && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3 flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">{selected.name}</p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {selected.ipAddress && <span>IP: <span className="text-violet-400 font-mono">{selected.ipAddress}</span></span>}
              {selected.prefix && <span>Prefix: <span className="font-mono">{selected.prefix}</span></span>}
              {selected.rateEffectiveFrom && (
                <span className="flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" />
                  From: {fmtUTC(selected.rateEffectiveFrom as any)}
                </span>
              )}
            </div>
            {selected.switchSyncStatus && (
              <div className="flex items-center gap-2 mt-1">
                <SyncBadge
                  {...resolveSyncStatus(selected.switchSyncStatus as any)}
                />
              </div>
            )}
          </div>
          <button
            data-testid="button-sync-profile"
            onClick={() => { setResult(null); syncMut.mutate(selected.id); }}
            disabled={syncMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/40 text-xs text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {syncMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
            Sync Profile
          </button>
        </div>
      )}

      {/* Result feedback */}
      {result && (
        <div className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${
          result.success
            ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-400'
            : 'bg-rose-500/5 border-rose-500/30 text-rose-400'
        }`}>
          {result.success
            ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            : <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <div className="flex-1">
            <p className="text-sm font-medium">{result.message}</p>
            {result.detail && <p className="text-xs opacity-80 mt-0.5">{result.detail}</p>}
            {result.results && Object.entries(result.results).length > 0 && (
              <div className="mt-2 space-y-1">
                {Object.entries(result.results).map(([key, r]: [string, any]) => (
                  <div key={key} className={`flex items-center gap-2 text-xs ${r.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {r.success ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> : <XCircle className="w-3 h-3 flex-shrink-0" />}
                    <span className="font-medium">{key}:</span>
                    <span className="opacity-80">{r.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setResult(null)} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Switch selector */}
      {enabledSwitches.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Server className="w-3 h-3" />
            Target Switches
            <span className="text-muted-foreground/60 normal-case tracking-normal">(leave all unchecked to use Primary)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {enabledSwitches.map(sw => (
              <button
                key={sw.id}
                type="button"
                data-testid={`btn-switch-select-${sw.id}`}
                onClick={() => toggleSwitch(sw.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  selectedSwitchIds.includes(sw.id)
                    ? sw.type === 'vos3000'
                      ? 'bg-blue-500/15 border-blue-500/60 text-blue-300'
                      : 'bg-violet-500/15 border-violet-500/60 text-violet-300'
                    : 'border-border/50 text-muted-foreground hover:bg-muted/30'
                }`}
              >
                {selectedSwitchIds.includes(sw.id) && <Check className="w-3 h-3" />}
                <span className={`w-1.5 h-1.5 rounded-full ${sw.type === 'vos3000' ? 'bg-blue-400' : 'bg-violet-400'}`} />
                {sw.name}
                <span className="opacity-60 font-mono">{sw.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Send button */}
      <div className="flex gap-3">
        <button
          data-testid="button-send-rate"
          onClick={() => { setResult(null); pushMut.mutate(); }}
          disabled={!canSend || pushMut.isPending}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {pushMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {selectedSwitchIds.length > 1
            ? `Send Rate to ${selectedSwitchIds.length} Switches`
            : 'Send Rate to Switch'}
        </button>
        <button
          data-testid="button-clear-send-rate"
          onClick={() => { setProfileId(''); setPrefix(''); setRatePerMin('0.0250'); setEffectiveFrom(''); setEffectiveTo(''); setResult(null); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>
    </div>
  );
}

// ── Low Balance / Auto-Recharge Modal (doc 107444) ───────────────────────────

interface LowBalanceConfig {
  success: boolean;
  threshold?: number | null;
  notifyByEmail?: boolean;
  chargeCard?: boolean;
  chargeAmount?: number;
  iDebitCreditCard?: number | null;
  notificationRetryCount?: number;
  notificationRetryInterval?: number | null;
  brChargeCard?: boolean;
  brChargeAmount?: number | null;
  error?: string;
}

function LowBalanceModal({ iAccount, username, onClose }: { iAccount: number; username: string; onClose: () => void }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<LowBalanceConfig>({
    queryKey: ['/api/sippy/accounts', iAccount, 'low-balance'],
    queryFn: () => fetch(`/api/sippy/accounts/${iAccount}/low-balance`).then(r => r.json()),
  });

  const [threshold, setThreshold]   = useState<string>('');
  const [notify, setNotify]         = useState(false);
  const [chargeCard, setChargeCard] = useState(false);
  const [chargeAmt, setChargeAmt]   = useState('');
  const [retryCount, setRetryCount] = useState('');
  const [brCharge, setBrCharge]     = useState(false);
  const [brAmt, setBrAmt]           = useState('');
  const [initialised, setInitialised] = useState(false);

  // Populate fields once data loads
  if (data && !isLoading && !initialised) {
    setThreshold(data.threshold != null ? String(data.threshold) : '');
    setNotify(!!data.notifyByEmail);
    setChargeCard(!!data.chargeCard);
    setChargeAmt(data.chargeAmount != null ? String(data.chargeAmount) : '');
    setRetryCount(data.notificationRetryCount != null ? String(data.notificationRetryCount) : '');
    setBrCharge(!!data.brChargeCard);
    setBrAmt(data.brChargeAmount != null ? String(data.brChargeAmount) : '');
    setInitialised(true);
  }

  const saveMut = useMutation({
    mutationFn: () => apiRequest('PATCH', `/api/sippy/accounts/${iAccount}/low-balance`, {
      threshold:               threshold !== '' ? parseFloat(threshold) : null,
      notifyByEmail:           notify,
      chargeCard:              chargeCard,
      chargeAmount:            chargeAmt !== '' ? parseFloat(chargeAmt) : undefined,
      notificationRetryCount:  retryCount !== '' ? parseInt(retryCount) : undefined,
      brChargeCard:            brCharge,
      brChargeAmount:          brAmt !== '' ? parseFloat(brAmt) : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sippy/accounts', iAccount, 'low-balance'] });
      onClose();
    },
  });

  const fieldCls = "w-full px-3 py-2 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "text-xs font-medium text-muted-foreground mb-1 block";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-violet-400" />
              Low Balance / Auto-Recharge
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">{username}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading…
            </div>
          ) : data?.error ? (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-rose-400 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {data.error}
            </div>
          ) : (
            <>
              {/* Threshold */}
              <div className="space-y-1.5">
                <label className={labelCls}>Balance Threshold ($) <span className="text-muted-foreground/60">(null = disabled)</span></label>
                <input data-testid="input-lb-threshold" type="number" step="0.01" value={threshold}
                  onChange={e => setThreshold(e.target.value)}
                  placeholder="e.g. 50.00 — leave blank to disable"
                  className={fieldCls} />
                <p className="text-xs text-muted-foreground">Alert/recharge fires when balance drops below this value.</p>
              </div>

              {/* Notification */}
              <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                <input data-testid="checkbox-lb-notify" type="checkbox" id="lb-notify" checked={notify}
                  onChange={e => setNotify(e.target.checked)}
                  className="rounded border-border accent-violet-500 w-4 h-4" />
                <div>
                  <label htmlFor="lb-notify" className="text-sm font-medium cursor-pointer">Email notification</label>
                  <p className="text-xs text-muted-foreground">Send email when balance hits threshold</p>
                </div>
              </div>
              {notify && (
                <div className="space-y-1.5 pl-4">
                  <label className={labelCls}>Retry Count <span className="text-muted-foreground/60">(since Sippy 2024)</span></label>
                  <input data-testid="input-lb-retry" type="number" min="0" value={retryCount}
                    onChange={e => setRetryCount(e.target.value)}
                    placeholder="0" className={fieldCls} />
                </div>
              )}

              {/* Auto-charge */}
              <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                <input data-testid="checkbox-lb-charge" type="checkbox" id="lb-charge" checked={chargeCard}
                  onChange={e => setChargeCard(e.target.checked)}
                  className="rounded border-border accent-violet-500 w-4 h-4" />
                <div>
                  <label htmlFor="lb-charge" className="text-sm font-medium cursor-pointer">Auto-charge card on low balance</label>
                  <p className="text-xs text-muted-foreground">Charge the account's primary card automatically</p>
                </div>
              </div>
              {chargeCard && (
                <div className="space-y-1.5 pl-4">
                  <label className={labelCls}>Charge Amount ($)</label>
                  <input data-testid="input-lb-charge-amt" type="number" step="0.01" min="0" value={chargeAmt}
                    onChange={e => setChargeAmt(e.target.value)}
                    placeholder="100.00" className={fieldCls} />
                </div>
              )}

              {/* Billing-run charge */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Billing Run Auto-Charge</p>
                <div className="flex items-center gap-3">
                  <input data-testid="checkbox-lb-br-charge" type="checkbox" id="lb-br" checked={brCharge}
                    onChange={e => setBrCharge(e.target.checked)}
                    className="rounded border-border accent-violet-500 w-4 h-4" />
                  <label htmlFor="lb-br" className="text-sm font-medium cursor-pointer">Auto-charge on billing run</label>
                </div>
                {brCharge && (
                  <div className="space-y-1.5">
                    <label className={labelCls}>Billing-Run Charge Amount ($) <span className="text-muted-foreground/60">(blank = Plan Price)</span></label>
                    <input data-testid="input-lb-br-amt" type="number" step="0.01" min="0" value={brAmt}
                      onChange={e => setBrAmt(e.target.value)}
                      placeholder="blank = use Plan Price" className={fieldCls} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {!isLoading && !data?.error && (
          <div className="px-6 pb-6 flex gap-3 justify-end border-t border-border pt-4">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
            <button
              data-testid="button-lb-save"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Auth Rules Panel (doc 107336) ─────────────────────────────────────────────

const PROTOCOLS: Record<number, string> = { 1: 'SIP', 2: 'H.323', 3: 'IAX2', 4: 'PIN' };

interface AuthRule {
  iAuthentication: number;
  iProtocol?: number;
  remoteIp?: string;
  incomingCli?: string;
  incomingCld?: string;
  toDomain?: string;
  fromDomain?: string;
  cliTranslationRule?: string;
  cldTranslationRule?: string;
  iTariff?: number | null;
  iRoutingGroup?: number | null;
  maxSessions?: number;
  maxCps?: number | null;
}

const emptyRule = { iProtocol: 1, remoteIp: '', incomingCli: '', incomingCld: '', toDomain: '', fromDomain: '', cliTranslationRule: '', cldTranslationRule: '', maxSessions: '', maxCps: '' };

function AuthRulesPanel({ iAccount, isManagement }: { iAccount: number; isManagement: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding]     = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm]         = useState({ ...emptyRule });
  const [editForm, setEditForm] = useState({ ...emptyRule, iAuthentication: 0 });

  const { data, isLoading } = useQuery<{ authRules: AuthRule[]; error?: string }>({
    queryKey: ['/api/sippy/accounts', iAccount, 'auth-rules'],
    queryFn: () => fetch(`/api/sippy/accounts/${iAccount}/auth-rules`).then(r => r.json()),
  });

  const rules = data?.authRules ?? [];

  const addMut = useMutation({
    mutationFn: () => apiRequest('POST', `/api/sippy/accounts/${iAccount}/auth-rules`, {
      iProtocol:          Number(form.iProtocol),
      remoteIp:           form.remoteIp           || undefined,
      incomingCli:        form.incomingCli         || undefined,
      incomingCld:        form.incomingCld         || undefined,
      toDomain:           form.toDomain            || undefined,
      fromDomain:         form.fromDomain          || undefined,
      cliTranslationRule: form.cliTranslationRule  || undefined,
      cldTranslationRule: form.cldTranslationRule  || undefined,
      maxSessions:        form.maxSessions ? Number(form.maxSessions) : undefined,
      maxCps:             form.maxCps ? Number(form.maxCps) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sippy/accounts', iAccount, 'auth-rules'] });
      setAdding(false);
      setForm({ ...emptyRule });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, f }: { id: number; f: typeof editForm }) => apiRequest('PATCH', `/api/sippy/auth-rules/${id}`, {
      iProtocol:          Number(f.iProtocol),
      remoteIp:           f.remoteIp           || undefined,
      incomingCli:        f.incomingCli         || undefined,
      incomingCld:        f.incomingCld         || undefined,
      toDomain:           f.toDomain            || undefined,
      fromDomain:         f.fromDomain          || undefined,
      cliTranslationRule: f.cliTranslationRule  || undefined,
      cldTranslationRule: f.cldTranslationRule  || undefined,
      maxSessions:        f.maxSessions ? Number(f.maxSessions) : undefined,
      maxCps:             f.maxCps ? Number(f.maxCps) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sippy/accounts', iAccount, 'auth-rules'] });
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/sippy/auth-rules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/sippy/accounts', iAccount, 'auth-rules'] }),
  });

  const fieldCls = "px-2 py-1.5 text-xs rounded-md bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary/50 w-full";

  function RuleForm({ f, setF, onSave, onCancel, isSaving }: { f: any; setF: (k: string, v: any) => void; onSave: () => void; onCancel: () => void; isSaving: boolean }) {
    const hasMatch = !!(f.remoteIp || f.incomingCli || f.incomingCld || f.toDomain || f.fromDomain);
    return (
      <div className="bg-muted/10 border border-border/50 rounded-lg p-4 space-y-3 mt-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Protocol *</p>
            <select value={f.iProtocol} onChange={e => setF('iProtocol', e.target.value)} className={fieldCls}>
              {Object.entries(PROTOCOLS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Caller IP</p>
            <input value={f.remoteIp} onChange={e => setF('remoteIp', e.target.value)} placeholder="e.g. 1.2.3.4" className={fieldCls} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Caller CLI</p>
            <input value={f.incomingCli} onChange={e => setF('incomingCli', e.target.value)} placeholder="e.g. +4420" className={fieldCls} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Called CLD</p>
            <input value={f.incomingCld} onChange={e => setF('incomingCld', e.target.value)} placeholder="e.g. +1800" className={fieldCls} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">To Domain</p>
            <input value={f.toDomain} onChange={e => setF('toDomain', e.target.value)} placeholder="sip.example.com" className={fieldCls} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">From Domain</p>
            <input value={f.fromDomain} onChange={e => setF('fromDomain', e.target.value)} placeholder="pbx.customer.com" className={fieldCls} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">CLI Trans. Rule</p>
            <input value={f.cliTranslationRule} onChange={e => setF('cliTranslationRule', e.target.value)} placeholder="s/^[+]//" className={`${fieldCls} font-mono`} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">CLD Trans. Rule</p>
            <input value={f.cldTranslationRule} onChange={e => setF('cldTranslationRule', e.target.value)} placeholder="s/^6043//" className={`${fieldCls} font-mono`} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Max Sessions</p>
            <input type="number" value={f.maxSessions} onChange={e => setF('maxSessions', e.target.value)} placeholder="-1 = ∞" className={fieldCls} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Max CPS</p>
            <input type="number" step="0.1" value={f.maxCps} onChange={e => setF('maxCps', e.target.value)} placeholder="blank = ∞" className={fieldCls} />
          </div>
        </div>
        {!hasMatch && (
          <p className="text-xs text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            At least one match field required: Caller IP, CLI, CLD, To Domain, or From Domain.
          </p>
        )}
        <div className="flex gap-2">
          <button data-testid="button-auth-rule-save"
            disabled={!hasMatch || isSaving}
            onClick={onSave}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Save Rule
          </button>
          <button onClick={onCancel} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors">
            <X className="w-3 h-3" /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-4 pt-2 border-t border-border/30 bg-muted/5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Shield className="w-3 h-3" /> Auth Rules
        </p>
        {isManagement && !adding && (
          <button data-testid="button-add-auth-rule"
            onClick={() => { setAdding(true); setForm({ ...emptyRule }); }}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md border border-violet-500/40 text-violet-400 hover:bg-violet-500/10 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Rule
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
      ) : data?.error ? (
        <p className="text-xs text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{data.error}</p>
      ) : rules.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground italic py-1">No auth rules — calls match by SIP username/password only.</p>
      ) : (
        <div className="space-y-1">
          {rules.map(rule => (
            <div key={rule.iAuthentication} data-testid={`row-auth-rule-${rule.iAuthentication}`}
              className="rounded-lg border border-border/40 bg-background/50 px-3 py-2">
              {editingId === rule.iAuthentication ? (
                <RuleForm
                  f={editForm}
                  setF={(k, v) => setEditForm(ef => ({ ...ef, [k]: v }))}
                  onSave={() => updateMut.mutate({ id: rule.iAuthentication, f: editForm })}
                  onCancel={() => setEditingId(null)}
                  isSaving={updateMut.isPending}
                />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="font-mono text-violet-400">#{rule.iAuthentication}</span>
                    {rule.iProtocol && (
                      <span className="text-muted-foreground">Protocol: <span className="text-foreground">{PROTOCOLS[rule.iProtocol] ?? rule.iProtocol}</span></span>
                    )}
                    {rule.remoteIp && <span className="text-muted-foreground">IP: <span className="font-mono text-foreground">{rule.remoteIp}</span></span>}
                    {rule.incomingCli && <span className="text-muted-foreground">CLI: <span className="font-mono text-foreground">{rule.incomingCli}</span></span>}
                    {rule.incomingCld && <span className="text-muted-foreground">CLD: <span className="font-mono text-foreground">{rule.incomingCld}</span></span>}
                    {rule.toDomain && <span className="text-muted-foreground">To: <span className="font-mono text-foreground">{rule.toDomain}</span></span>}
                    {rule.fromDomain && <span className="text-muted-foreground">From: <span className="font-mono text-foreground">{rule.fromDomain}</span></span>}
                    {rule.cliTranslationRule && <span className="text-muted-foreground">CLI rule: <code className="text-[10px] font-mono text-amber-300">{rule.cliTranslationRule}</code></span>}
                    {rule.cldTranslationRule && <span className="text-muted-foreground">CLD rule: <code className="text-[10px] font-mono text-amber-300">{rule.cldTranslationRule}</code></span>}
                    {rule.maxSessions != null && <span className="text-muted-foreground">Sessions: <span className="text-foreground">{rule.maxSessions === -1 ? '∞' : rule.maxSessions}</span></span>}
                    {rule.maxCps != null && <span className="text-muted-foreground">CPS: <span className="text-foreground">{rule.maxCps ?? '∞'}</span></span>}
                  </div>
                  {isManagement && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button data-testid={`button-edit-auth-rule-${rule.iAuthentication}`}
                        onClick={() => {
                          setEditingId(rule.iAuthentication);
                          setEditForm({
                            iProtocol: rule.iProtocol ?? 1,
                            remoteIp: rule.remoteIp ?? '',
                            incomingCli: rule.incomingCli ?? '',
                            incomingCld: rule.incomingCld ?? '',
                            toDomain: rule.toDomain ?? '',
                            fromDomain: rule.fromDomain ?? '',
                            cliTranslationRule: rule.cliTranslationRule ?? '',
                            cldTranslationRule: rule.cldTranslationRule ?? '',
                            maxSessions: rule.maxSessions != null ? String(rule.maxSessions) : '',
                            maxCps: rule.maxCps != null ? String(rule.maxCps) : '',
                            iAuthentication: rule.iAuthentication,
                          } as any);
                        }}
                        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button data-testid={`button-delete-auth-rule-${rule.iAuthentication}`}
                        onClick={() => { if (confirm('Delete this auth rule?')) deleteMut.mutate(rule.iAuthentication); }}
                        disabled={deleteMut.isPending}
                        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-rose-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <RuleForm
          f={form}
          setF={(k, v) => setForm(ef => ({ ...ef, [k]: v }))}
          onSave={() => addMut.mutate()}
          onCancel={() => { setAdding(false); setForm({ ...emptyRule }); }}
          isSaving={addMut.isPending}
        />
      )}
    </div>
  );
}

// ── Sippy Accounts Tab (docs 107322 + 107366 + 107336 + 107444) ──────────────

interface SippyAccount {
  iAccount: number;
  username: string;
  description: string;
  blocked: boolean;
  expired: boolean;
  balance: number;
  creditLimit: number;
  baseCurrency: string;
  registration: { registered: boolean; userAgent?: string; contact?: string; expires?: string } | null;
}

// ── Vendor Connections Panel (expandable per vendor) ─────────────────────────

interface VendorConnection {
  iConnection: number;
  name: string;
  destination: string;
  username?: string;
  capacity?: number;
  enforceCapacity?: boolean;
  maxCps?: number;
  blocked?: boolean;
  iProtoTransport?: number;
  huntstopScodes?: string;
  timeout100?: number;
  translationRule?: string;
  cliTranslationRule?: string;
  outboundProxy?: string;
  // Quality Monitoring (qmon) — Sippy docs 107435
  qmonAcdEnabled?: boolean;
  qmonAsrEnabled?: boolean;
  qmonPddEnabled?: boolean;
  qmonStatWindow?: number;
  qmonAcdThreshold?: number;
  qmonAsrThreshold?: number;
  qmonPddThreshold?: number;
  qmonRetryInterval?: number;
  qmonRetryBatch?: number;
  qmonAction?: string;
  qmonNotificationEnabled?: boolean;
}

interface SippyVendor {
  iVendor: number;
  name: string;
  balance?: number;
  baseCurrency?: string;
  companyName?: string;
}

const PROTO_TRANSPORT_OPTIONS = [
  { value: '1', label: 'SIP' },
  { value: '2', label: 'H.323' },
  { value: '3', label: 'IAX2' },
];

const emptyConn = {
  name: '', destination: '', connUsername: '', password: '',
  capacity: '', enforceCapacity: true, maxCps: '',
  iProtoTransport: '1', huntstopScodes: '', timeout100: '',
  blocked: false, translationRule: '', cliTranslationRule: '', outboundProxy: '',
  // Quality Monitoring
  qmonAcdEnabled: false, qmonAsrEnabled: false, qmonPddEnabled: false,
  qmonStatWindow: '300', qmonAcdThreshold: '', qmonAsrThreshold: '',
  qmonPddThreshold: '', qmonRetryInterval: '300', qmonRetryBatch: '3',
  qmonAction: 'disable', qmonNotificationEnabled: false,
};

function VendorConnectionsPanel({ iVendor, isManagement }: { iVendor: number; isManagement: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyConn });
  const [editForm, setEditForm] = useState({ ...emptyConn, iConnection: 0 });

  const { data, isLoading } = useQuery<{ connections: VendorConnection[]; error?: string }>({
    queryKey: ['/api/sippy/vendors', iVendor, 'connections'],
    queryFn: () => fetch(`/api/sippy/vendors/${iVendor}/connections`).then(r => r.json()),
  });

  const connections = data?.connections ?? [];

  const connPayload = (f: typeof emptyConn) => ({
    name:               f.name,
    destination:        f.destination,
    connUsername:       f.connUsername       || undefined,
    password:           f.password          || undefined,
    capacity:           f.capacity          ? Number(f.capacity)        : undefined,
    enforceCapacity:    f.enforceCapacity,
    maxCps:             f.maxCps            ? Number(f.maxCps)          : undefined,
    blocked:            f.blocked,
    iProtoTransport:    f.iProtoTransport   ? Number(f.iProtoTransport) : undefined,
    huntstopScodes:     f.huntstopScodes    || undefined,
    timeout100:         f.timeout100        ? Number(f.timeout100)      : undefined,
    translationRule:    f.translationRule   || undefined,
    cliTranslationRule: f.cliTranslationRule || undefined,
    outboundProxy:      f.outboundProxy     || undefined,
    // Quality Monitoring
    qmonAcdEnabled:          f.qmonAcdEnabled,
    qmonAsrEnabled:          f.qmonAsrEnabled,
    qmonPddEnabled:          f.qmonPddEnabled,
    qmonStatWindow:          f.qmonStatWindow     ? Number(f.qmonStatWindow)     : undefined,
    qmonAcdThreshold:        f.qmonAcdThreshold   ? Number(f.qmonAcdThreshold)   : undefined,
    qmonAsrThreshold:        f.qmonAsrThreshold   ? Number(f.qmonAsrThreshold)   : undefined,
    qmonPddThreshold:        f.qmonPddThreshold   ? Number(f.qmonPddThreshold)   : undefined,
    qmonRetryInterval:       f.qmonRetryInterval  ? Number(f.qmonRetryInterval)  : undefined,
    qmonRetryBatch:          f.qmonRetryBatch     ? Number(f.qmonRetryBatch)     : undefined,
    qmonAction:              f.qmonAction         || undefined,
    qmonNotificationEnabled: f.qmonNotificationEnabled,
  });

  const addMut = useMutation({
    mutationFn: () => apiRequest('POST', `/api/sippy/vendors/${iVendor}/connections`, connPayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sippy/vendors', iVendor, 'connections'] });
      setAdding(false);
      setForm({ ...emptyConn });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, f }: { id: number; f: typeof editForm }) => apiRequest('PATCH', `/api/sippy/connections/${id}`, connPayload(f)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sippy/vendors', iVendor, 'connections'] });
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/sippy/connections/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/sippy/vendors', iVendor, 'connections'] }),
  });

  const fieldCls = "px-2 py-1.5 text-xs rounded-md bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary/50 w-full";

  function ConnForm({ f, setF, onSave, onCancel, isSaving }: { f: any; setF: (k: string, v: any) => void; onSave: () => void; onCancel: () => void; isSaving: boolean }) {
    const sectionHdr = "text-[10px] font-semibold text-violet-400/80 uppercase tracking-widest mb-2 flex items-center gap-1.5";
    const label = "text-[10px] text-muted-foreground mb-1 uppercase tracking-wider";
    return (
      <div className="bg-muted/10 border border-border/50 rounded-lg p-4 space-y-4 mt-2">

        {/* ── Basic ── */}
        <div>
          <p className={sectionHdr}><Cable className="w-3 h-3" /> Basic</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <p className={label}>Name *</p>
              <input data-testid="input-conn-name" value={f.name} onChange={e => setF('name', e.target.value)} placeholder="e.g. Main Trunk" className={fieldCls} />
            </div>
            <div>
              <p className={label}>Destination (IP/Host:Port) *</p>
              <input data-testid="input-conn-destination" value={f.destination} onChange={e => setF('destination', e.target.value)} placeholder="e.g. 1.2.3.4:5060" className={`${fieldCls} font-mono`} />
            </div>
            <div>
              <p className={label}>Protocol</p>
              <select data-testid="select-conn-proto" value={f.iProtoTransport} onChange={e => setF('iProtoTransport', e.target.value)} className={fieldCls}>
                {PROTO_TRANSPORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-3">
              <p className={label}>Outbound Proxy (optional)</p>
              <input data-testid="input-conn-outbound-proxy" value={f.outboundProxy} onChange={e => setF('outboundProxy', e.target.value)} placeholder="proxy.carrier.com:5060" className={`${fieldCls} font-mono`} />
            </div>
          </div>
        </div>

        {/* ── Auth ── */}
        <div>
          <p className={sectionHdr}><Shield className="w-3 h-3" /> Auth (Digest)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={label}>Username</p>
              <input data-testid="input-conn-username" value={f.connUsername} onChange={e => setF('connUsername', e.target.value)} placeholder="Optional" className={fieldCls} />
            </div>
            <div>
              <p className={label}>Password</p>
              <input data-testid="input-conn-password" type="password" value={f.password} onChange={e => setF('password', e.target.value)} placeholder="Optional" className={fieldCls} />
            </div>
          </div>
        </div>

        {/* ── Capacity & Limits ── */}
        <div>
          <p className={sectionHdr}><Activity className="w-3 h-3" /> Capacity & Limits</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <p className={label}>Max Concurrent Calls</p>
              <input data-testid="input-conn-capacity" type="number" min="0" value={f.capacity} onChange={e => setF('capacity', e.target.value)} placeholder="Unlimited" className={fieldCls} />
            </div>
            <div>
              <p className={label}>Max CPS</p>
              <input data-testid="input-conn-max-cps" type="number" min="0" step="0.1" value={f.maxCps} onChange={e => setF('maxCps', e.target.value)} placeholder="Unlimited" className={fieldCls} />
            </div>
            <div className="flex items-center gap-3 pt-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input data-testid="checkbox-conn-enforce-capacity" type="checkbox" checked={!!f.enforceCapacity} onChange={e => setF('enforceCapacity', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border accent-violet-600" />
                <span className="text-xs text-muted-foreground">Enforce capacity limit</span>
              </label>
            </div>
          </div>
        </div>

        {/* ── Routing & Translation ── */}
        <div>
          <p className={sectionHdr}><ArrowRightLeft className="w-3 h-3" /> Routing & Translation</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <p className={label}>CLD Translation Rule</p>
              <input data-testid="input-conn-translation-rule" value={f.translationRule} onChange={e => setF('translationRule', e.target.value)} placeholder="s/^[+]//" className={`${fieldCls} font-mono`} />
            </div>
            <div>
              <p className={label}>CLI Translation Rule</p>
              <input data-testid="input-conn-cli-rule" value={f.cliTranslationRule} onChange={e => setF('cliTranslationRule', e.target.value)} placeholder="s/^[+]//" className={`${fieldCls} font-mono`} />
            </div>
            <div>
              <p className={label}>Hunt-Stop SIP Codes</p>
              <input data-testid="input-conn-huntstop" value={f.huntstopScodes} onChange={e => setF('huntstopScodes', e.target.value)} placeholder="e.g. 404,503" className={`${fieldCls} font-mono`} />
            </div>
          </div>
        </div>

        {/* ── Advanced ── */}
        <div>
          <p className={sectionHdr}><Settings2 className="w-3 h-3" /> Advanced</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <p className={label}>100 Trying Timeout (s)</p>
              <input data-testid="input-conn-timeout100" type="number" min="1" max="60" value={f.timeout100} onChange={e => setF('timeout100', e.target.value)} placeholder="5" className={fieldCls} />
            </div>
            <div className="flex items-center gap-3 pt-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input data-testid="checkbox-conn-blocked" type="checkbox" checked={!!f.blocked} onChange={e => setF('blocked', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border accent-rose-600" />
                <span className="text-xs text-muted-foreground">Block this connection</span>
              </label>
            </div>
          </div>
        </div>

        {/* ── Quality Monitoring (qmon) ── */}
        <div>
          <p className={sectionHdr}><Activity className="w-3 h-3" /> Quality Monitoring (qmon)</p>
          <div className="space-y-3">
            {/* Enable toggles */}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input data-testid="checkbox-conn-qmon-acd" type="checkbox" checked={!!f.qmonAcdEnabled} onChange={e => setF('qmonAcdEnabled', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border accent-amber-500" />
                <span className="text-xs text-muted-foreground">Monitor ACD</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input data-testid="checkbox-conn-qmon-asr" type="checkbox" checked={!!f.qmonAsrEnabled} onChange={e => setF('qmonAsrEnabled', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border accent-amber-500" />
                <span className="text-xs text-muted-foreground">Monitor ASR</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input data-testid="checkbox-conn-qmon-pdd" type="checkbox" checked={!!f.qmonPddEnabled} onChange={e => setF('qmonPddEnabled', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border accent-amber-500" />
                <span className="text-xs text-muted-foreground">Monitor PDD</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input data-testid="checkbox-conn-qmon-notify" type="checkbox" checked={!!f.qmonNotificationEnabled} onChange={e => setF('qmonNotificationEnabled', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border accent-amber-500" />
                <span className="text-xs text-muted-foreground">Email Notifications</span>
              </label>
            </div>
            {/* Thresholds — only show when at least one monitor is enabled */}
            {(f.qmonAcdEnabled || f.qmonAsrEnabled || f.qmonPddEnabled) && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 border-t border-border/20 pt-3">
                {f.qmonAcdEnabled && (
                  <div>
                    <p className={label}>Min ACD Threshold (s)</p>
                    <input data-testid="input-conn-qmon-acd-threshold" type="number" min="0" step="1" value={f.qmonAcdThreshold} onChange={e => setF('qmonAcdThreshold', e.target.value)}
                      placeholder="e.g. 120" className={fieldCls} />
                  </div>
                )}
                {f.qmonAsrEnabled && (
                  <div>
                    <p className={label}>Min ASR Threshold (%)</p>
                    <input data-testid="input-conn-qmon-asr-threshold" type="number" min="0" max="100" step="0.1" value={f.qmonAsrThreshold} onChange={e => setF('qmonAsrThreshold', e.target.value)}
                      placeholder="e.g. 40" className={fieldCls} />
                  </div>
                )}
                {f.qmonPddEnabled && (
                  <div>
                    <p className={label}>Max PDD Threshold (s)</p>
                    <input data-testid="input-conn-qmon-pdd-threshold" type="number" min="0" step="0.1" value={f.qmonPddThreshold} onChange={e => setF('qmonPddThreshold', e.target.value)}
                      placeholder="e.g. 8" className={fieldCls} />
                  </div>
                )}
                <div>
                  <p className={label}>Stat Window (s)</p>
                  <input data-testid="input-conn-qmon-stat-window" type="number" min="60" step="60" value={f.qmonStatWindow} onChange={e => setF('qmonStatWindow', e.target.value)}
                    placeholder="300" className={fieldCls} />
                </div>
                <div>
                  <p className={label}>Action on Breach</p>
                  <select data-testid="select-conn-qmon-action" value={f.qmonAction} onChange={e => setF('qmonAction', e.target.value)} className={fieldCls}>
                    <option value="disable">Disable</option>
                    <option value="suspend">Suspend</option>
                    <option value="alert">Alert Only</option>
                  </select>
                </div>
                <div>
                  <p className={label}>Retry Interval (s)</p>
                  <input data-testid="input-conn-qmon-retry-interval" type="number" min="60" value={f.qmonRetryInterval} onChange={e => setF('qmonRetryInterval', e.target.value)}
                    placeholder="300" className={fieldCls} />
                </div>
                <div>
                  <p className={label}>Retry Batch (calls)</p>
                  <input data-testid="input-conn-qmon-retry-batch" type="number" min="1" value={f.qmonRetryBatch} onChange={e => setF('qmonRetryBatch', e.target.value)}
                    placeholder="3" className={fieldCls} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end pt-1 border-t border-border/30">
          <button data-testid="button-cancel-conn" onClick={onCancel} className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 transition-colors">Cancel</button>
          <button data-testid="button-save-conn" onClick={onSave} disabled={isSaving || !f.name || !f.destination}
            className="px-3 py-1.5 text-xs rounded-md bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-50">
            {isSaving ? 'Saving…' : 'Save Connection'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pb-4 pt-2 bg-muted/5 border-t border-border/30">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-violet-400 flex items-center gap-1.5">
          <Cable className="w-3.5 h-3.5" /> Vendor Connections
        </p>
        {isManagement && !adding && (
          <button data-testid={`button-add-connection-${iVendor}`}
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md bg-violet-600/90 text-white hover:bg-violet-500 transition-colors">
            <Plus className="w-3 h-3" /> Add Connection
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading connections…
        </div>
      ) : data?.error ? (
        <p className="text-xs text-rose-400 py-2">{data.error}</p>
      ) : connections.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground/60 py-2">No connections — add one to define outbound routes for this vendor.</p>
      ) : (
        <div className="space-y-1.5">
          {connections.map(conn => (
            <div key={conn.iConnection} data-testid={`row-vendor-connection-${conn.iConnection}`}>
              {editingId === conn.iConnection ? (
                <ConnForm
                  f={editForm}
                  setF={(k, v) => setEditForm(p => ({ ...p, [k]: v }))}
                  onSave={() => updateMut.mutate({ id: conn.iConnection, f: editForm })}
                  onCancel={() => setEditingId(null)}
                  isSaving={updateMut.isPending}
                />
              ) : (
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-background/60 border border-border/40 hover:border-border/70 transition-colors group">
                  <Cable className="w-3.5 h-3.5 text-violet-400/70 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">{conn.name}</span>
                      {conn.blocked && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-semibold uppercase tracking-wider">Blocked</span>
                      )}
                      {/* qmon status badges */}
                      {conn.qmonAcdEnabled && (
                        <span title={`ACD ≥ ${conn.qmonAcdThreshold ?? '?'}s`} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">ACD</span>
                      )}
                      {conn.qmonAsrEnabled && (
                        <span title={`ASR ≥ ${conn.qmonAsrThreshold ?? '?'}%`} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">ASR</span>
                      )}
                      {conn.qmonPddEnabled && (
                        <span title={`PDD ≤ ${conn.qmonPddThreshold ?? '?'}s`} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">PDD</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground font-mono">{conn.destination}</span>
                      {conn.iProtoTransport !== undefined && (
                        <span className="text-[10px] text-muted-foreground">{PROTO_TRANSPORT_OPTIONS.find(p => p.value === String(conn.iProtoTransport))?.label ?? 'SIP'}</span>
                      )}
                      {conn.username && <span className="text-[10px] text-muted-foreground">user: {conn.username}</span>}
                      {conn.capacity !== undefined && conn.capacity > 0 && <span className="text-[10px] text-muted-foreground">cap: {conn.capacity}{conn.enforceCapacity === false ? ' (soft)' : ''}</span>}
                      {conn.maxCps !== undefined && conn.maxCps > 0 && <span className="text-[10px] text-muted-foreground">{conn.maxCps} cps</span>}
                      {conn.translationRule && <span className="text-[10px] text-muted-foreground font-mono">cld: {conn.translationRule}</span>}
                      {conn.cliTranslationRule && <span className="text-[10px] text-muted-foreground font-mono">cli: {conn.cliTranslationRule}</span>}
                      {conn.huntstopScodes && <span className="text-[10px] text-muted-foreground font-mono">stop: {conn.huntstopScodes}</span>}
                      {(conn.qmonAcdEnabled || conn.qmonAsrEnabled || conn.qmonPddEnabled) && conn.qmonAction && (
                        <span className="text-[10px] text-muted-foreground">on breach: {conn.qmonAction}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground/40 font-mono">id:{conn.iConnection}</span>
                    </div>
                  </div>
                  {isManagement && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button data-testid={`button-edit-connection-${conn.iConnection}`}
                        title="Edit connection"
                        disabled={loadingEditId === conn.iConnection}
                        onClick={async () => {
                          setLoadingEditId(conn.iConnection);
                          try {
                            const full = await fetch(`/api/sippy/connections/${conn.iConnection}`).then(r => r.json());
                            const c: VendorConnection = full.connection ?? conn;
                            setEditForm({
                              name:                    c.name,
                              destination:             c.destination,
                              connUsername:            c.username              || '',
                              password:                '',
                              capacity:                c.capacity?.toString()         || '',
                              enforceCapacity:         c.enforceCapacity          ?? true,
                              maxCps:                  c.maxCps?.toString()           || '',
                              blocked:                 c.blocked                  ?? false,
                              iProtoTransport:         c.iProtoTransport?.toString()  || '1',
                              huntstopScodes:          c.huntstopScodes               || '',
                              timeout100:              c.timeout100?.toString()        || '',
                              translationRule:         c.translationRule              || '',
                              cliTranslationRule:      c.cliTranslationRule           || '',
                              outboundProxy:           c.outboundProxy                || '',
                              iConnection:             c.iConnection,
                              // Quality Monitoring
                              qmonAcdEnabled:          c.qmonAcdEnabled          ?? false,
                              qmonAsrEnabled:          c.qmonAsrEnabled          ?? false,
                              qmonPddEnabled:          c.qmonPddEnabled          ?? false,
                              qmonStatWindow:          c.qmonStatWindow?.toString()   || '300',
                              qmonAcdThreshold:        c.qmonAcdThreshold?.toString() || '',
                              qmonAsrThreshold:        c.qmonAsrThreshold?.toString() || '',
                              qmonPddThreshold:        c.qmonPddThreshold?.toString() || '',
                              qmonRetryInterval:       c.qmonRetryInterval?.toString()|| '300',
                              qmonRetryBatch:          c.qmonRetryBatch?.toString()   || '3',
                              qmonAction:              c.qmonAction                   || 'disable',
                              qmonNotificationEnabled: c.qmonNotificationEnabled  ?? false,
                            });
                          } finally {
                            setLoadingEditId(null);
                          }
                          setEditingId(conn.iConnection);
                        }}
                        className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                        {loadingEditId === conn.iConnection ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pencil className="w-3 h-3" />}
                      </button>
                      <button data-testid={`button-delete-connection-${conn.iConnection}`}
                        title="Delete connection"
                        onClick={() => deleteMut.mutate(conn.iConnection)}
                        disabled={deleteMut.isPending}
                        className="p-1 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors disabled:opacity-50">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <ConnForm
          f={form}
          setF={(k, v) => setForm(p => ({ ...p, [k]: v }))}
          onSave={() => addMut.mutate()}
          onCancel={() => { setAdding(false); setForm({ ...emptyConn }); }}
          isSaving={addMut.isPending}
        />
      )}
    </div>
  );
}

// ── Sippy Live Stats Tab ───────────────────────────────────────────────────────

interface AccountStatRow {
  name: string;
  totalCalls: number;
  billableCalls: number;
  durationSec: number;
  acdSec: number;
  asr: number;
  avgPdd: number;
  amount: number;
}
interface PerAccountStats {
  ok: boolean;
  period: string;
  fetchedAt: string;
  clients: AccountStatRow[];
  vendors: AccountStatRow[];
  origTotal: AccountStatRow;
  termTotal: AccountStatRow;
  error?: string;
}
interface SippyCustomerEntry {
  iCustomer: number;
  name: string;
  webLogin: string;
  balance: number;
  creditLimit: number;
  baseCurrency: string;
}
interface SippyVendorEntry {
  iVendor: number;
  name: string;
  balance: number;
  baseCurrency: string;
}

function fmtDuration(sec: number): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtAsr(v: number): string {
  if (!v) return '—';
  return v.toFixed(2) + '%';
}
function fmtUsd(v: number): string {
  if (!v) return '—';
  return '$' + v.toFixed(4);
}
function fmtBal(v: number | undefined, cur: string = 'USD'): string {
  if (v === undefined || v === null) return '—';
  return (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2) + ' ' + cur;
}

function StatRow({ row, amountLabel, highlight }: { row: AccountStatRow; amountLabel: string; highlight?: boolean }) {
  const bg = highlight ? 'bg-muted/30 font-semibold' : 'hover:bg-muted/10';
  return (
    <tr className={`text-sm border-b border-border/30 ${bg} transition-colors`}>
      <td className="px-3 py-2.5 text-left max-w-[180px] truncate" title={row.name}>
        {row.name || <span className="text-muted-foreground italic">Total</span>}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{row.totalCalls || '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{row.billableCalls || '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{fmtDuration(row.durationSec)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{fmtDuration(row.acdSec)}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${
        row.asr >= 50 ? 'text-emerald-400' : row.asr > 0 ? 'text-amber-400' : 'text-muted-foreground'
      }`}>{fmtAsr(row.asr)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{row.avgPdd ? row.avgPdd.toFixed(2) : '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-400">{fmtUsd(row.amount)}</td>
    </tr>
  );
}

function SippyLiveStatsTab() {
  const [period, setPeriod] = useState(90);
  const [subTab, setSubTab] = useState<'clients' | 'vendors'>('clients');

  const { data: stats, isLoading: statsLoading, refetch, dataUpdatedAt } = useQuery<PerAccountStats>({
    queryKey: ['/api/sippy/per-account-stats', period],
    queryFn: () => fetch(`/api/sippy/per-account-stats?period=${period}`).then(r => r.json()),
    refetchInterval: 60000,
  });

  // Fetch individual accounts (PUSHTOTALK/aircel/asif) under RTST1 (iCustomer=2)
  const { data: accountsData } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ['/api/sippy/accounts'],
    queryFn: () => fetch('/api/sippy/accounts?iCustomer=2').then(r => r.json()),
    refetchInterval: 120000,
  });

  const { data: vendData } = useQuery<{ vendors: SippyVendorEntry[] }>({
    queryKey: ['/api/sippy/vendors'],
    queryFn: () => fetch('/api/sippy/vendors').then(r => r.json()),
    refetchInterval: 120000,
  });

  const accounts = accountsData?.accounts ?? [];
  const vendors   = vendData?.vendors   ?? [];

  const clientRows = stats?.clients  ?? [];
  const vendorRows  = stats?.vendors   ?? [];

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  const PERIODS = [
    { label: '30 min', value: 30 },
    { label: '1 hour', value: 60 },
    { label: '90 min', value: 90 },
    { label: '3 hours', value: 180 },
    { label: '6 hours', value: 360 },
    { label: '24 hours', value: 1440 },
  ];

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <span className="font-semibold text-sm">Sippy Live Traffic — Per Account</span>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground ml-2">Updated {lastUpdated}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={e => setPeriod(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
            data-testid="select-stats-period"
          >
            {PERIODS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            disabled={statsLoading}
            data-testid="button-refresh-live-stats"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${statsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error / warning */}
      {stats?.error && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">Could not load live stats: </span>
            {stats.error}
          </div>
        </div>
      )}

      {/* Totals summary cards */}
      {stats?.ok && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Orig Calls', value: stats.origTotal.totalCalls || '—', sub: `${stats.origTotal.billableCalls} billable`, color: 'emerald' },
            { label: 'Orig ASR', value: fmtAsr(stats.origTotal.asr), sub: `ACD ${fmtDuration(stats.origTotal.acdSec)}`, color: stats.origTotal.asr >= 50 ? 'emerald' : 'amber' },
            { label: 'Term Calls', value: stats.termTotal.totalCalls || '—', sub: `${stats.termTotal.billableCalls} billable`, color: 'violet' },
            { label: 'Term ASR', value: fmtAsr(stats.termTotal.asr), sub: `ACD ${fmtDuration(stats.termTotal.acdSec)}`, color: stats.termTotal.asr >= 50 ? 'emerald' : 'amber' },
          ].map(c => (
            <div key={c.label} className="bg-card border border-border/60 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">{c.label}</p>
              <p className={`text-xl font-bold text-${c.color}-400`}>{c.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sub-tab: Clients / Vendors */}
      <div className="flex gap-1 bg-muted/20 p-1 rounded-lg w-fit border border-border/40">
        {(['clients', 'vendors'] as const).map(t => (
          <button
            key={t}
            data-testid={`tab-live-${t}`}
            onClick={() => setSubTab(t)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
              subTab === t
                ? 'bg-card text-foreground shadow-sm border border-border/50'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'clients' ? `Clients / Origination (${clientRows.length})` : `Vendors / Termination (${vendorRows.length})`}
          </button>
        ))}
      </div>

      {/* Accounts list + stats table */}
      {subTab === 'clients' ? (
        <div className="space-y-4">
          {/* Balance cards for individual accounts (PUSHTOTALK / aircel / asif) */}
          {accounts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {accounts.map(acc => {
                const availCredits = acc.creditLimit + acc.balance;
                const noCredit = !acc.blocked && !acc.expired && availCredits <= 0;
                const iconColor = acc.blocked ? 'text-rose-400' : noCredit ? 'text-amber-400' : 'text-emerald-400';
                const iconBg   = acc.blocked ? 'bg-rose-500/10 border-rose-500/20' : noCredit ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20';
                return (
                  <div key={acc.iAccount} className="bg-card border border-border/60 rounded-xl p-3 flex items-center justify-between gap-2"
                    data-testid={`card-account-${acc.iAccount}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${iconBg}`}>
                        <Building2 className={`w-4 h-4 ${iconColor}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{acc.username}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Acct {acc.iAccount}
                          {acc.blocked ? <span className="ml-1 text-rose-400">· Blocked</span> : ''}
                          {acc.expired ? <span className="ml-1 text-amber-400">· Expired</span> : ''}
                          {noCredit  ? <span className="ml-1 text-amber-400">· No Credit</span> : ''}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold ${availCredits <= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {fmtBal(availCredits, acc.baseCurrency)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Avail · Limit {fmtBal(acc.creditLimit, acc.baseCurrency)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Origination stats table */}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Origination — by Caller</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Last {stats?.period ?? `${period} min`}</span>
            </div>
            {statsLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : clientRows.length === 0 ? (
              <div className="py-10 text-center space-y-1">
                <p className="text-sm text-muted-foreground">No account-authenticated origination traffic in the selected period.</p>
                <p className="text-xs text-muted-foreground/60">
                  IP-authenticated calls are tracked in the Termination (vendor) section.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20">
                      {['Caller / Account', 'Calls', 'Billable', 'Duration', 'ACD', 'ASR %', 'Avg PDD', 'Revenue USD'].map(h => (
                        <th key={h} className="px-3 py-2 text-right first:text-left font-semibold uppercase tracking-wider text-muted-foreground/70 text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {clientRows.map((row, i) => (
                      <StatRow key={i} row={row} amountLabel="Revenue" />
                    ))}
                    {stats?.origTotal && stats.origTotal.totalCalls > 0 && (
                      <StatRow row={{ ...stats.origTotal, name: 'Total' }} amountLabel="Revenue" highlight />
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Balance cards for known vendors */}
          {vendors.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {vendors.map(v => (
                <div key={v.iVendor} className="bg-card border border-border/60 rounded-xl p-3 flex items-center justify-between gap-2"
                  data-testid={`card-vendor-${v.iVendor}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                      <Server className="w-4 h-4 text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{v.name}</p>
                      <p className="text-[10px] text-muted-foreground">Vendor ID {v.iVendor}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-semibold ${(v.balance ?? 0) < 0 ? 'text-rose-400' : 'text-violet-400'}`}>{fmtBal(v.balance, v.baseCurrency)}</p>
                    <p className="text-[10px] text-muted-foreground">Balance</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Termination stats table */}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Termination — by Vendor/Connection</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Last {stats?.period ?? `${period} min`}</span>
            </div>
            {statsLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : vendorRows.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No termination traffic in the last {period} minutes
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20">
                      {['Vendor / Connection', 'Calls', 'Billable', 'Duration', 'ACD', 'ASR %', 'Avg PDD', 'Cost USD'].map(h => (
                        <th key={h} className="px-3 py-2 text-right first:text-left font-semibold uppercase tracking-wider text-muted-foreground/70 text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vendorRows.map((row, i) => (
                      <StatRow key={i} row={row} amountLabel="Cost" />
                    ))}
                    {stats?.termTotal && stats.termTotal.totalCalls > 0 && (
                      <StatRow row={{ ...stats.termTotal, name: 'Total' }} amountLabel="Cost" highlight />
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sippy Vendors Tab ─────────────────────────────────────────────────────────

function SippyVendorsTab({ isManagement }: { isManagement: boolean }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<{ vendors: SippyVendor[]; error?: string }>({
    queryKey: ['/api/sippy/vendors'],
    queryFn: () => fetch('/api/sippy/vendors?limit=200').then(r => r.json()),
    staleTime: 30_000,
  });

  const vendors = data?.vendors ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Network className="w-4 h-4 text-violet-400" />
            Sippy Vendors
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Vendors on your Sippy switch — click <Cable className="inline w-3 h-3 mx-0.5" /> to manage outbound connections
          </p>
        </div>
        <button data-testid="button-refresh-sippy-vendors"
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading vendors…
        </div>
      ) : data?.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-6 py-8 flex flex-col items-center gap-3 text-rose-400">
          <AlertTriangle className="w-8 h-8 opacity-50" />
          <p className="text-sm font-medium">{data.error}</p>
          <Link href="/settings" className="mt-1 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs font-medium hover:bg-rose-500/20 transition-colors">
            Go to Settings →
          </Link>
        </div>
      ) : vendors.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/60 flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Network className="w-10 h-10 opacity-20" />
          <p className="text-sm">No vendors found on this Sippy switch.</p>
          <p className="text-xs opacity-70">Create a vendor using the <strong>New Sippy Account</strong> button (select Vendor type).</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card/60">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-5 py-2.5 bg-muted/20 border-b border-border/50 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span>Vendor</span>
            <span className="text-right">Balance</span>
            <span className="text-center">Currency</span>
            <span className="text-center">Connections</span>
          </div>
          <div className="divide-y divide-border/30">
            {vendors.map(vendor => {
              const isExpanded = expandedId === vendor.iVendor;
              return (
                <div key={vendor.iVendor} data-testid={`row-sippy-vendor-${vendor.iVendor}`}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-5 py-3.5 hover:bg-muted/10 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{vendor.name}</span>
                      </div>
                      {vendor.companyName && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{vendor.companyName}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">id: {vendor.iVendor}</p>
                    </div>
                    <div className="text-right">
                      {vendor.balance !== undefined ? (
                        <span className={`text-sm font-mono font-semibold ${vendor.balance < 0 ? 'text-rose-400' : vendor.balance === 0 ? 'text-muted-foreground' : 'text-emerald-400'}`}>
                          {vendor.balance < 0 ? '-' : ''}{Math.abs(vendor.balance).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground font-mono">{vendor.baseCurrency ?? '—'}</span>
                    </div>
                    <div className="flex justify-center">
                      <button data-testid={`button-toggle-connections-${vendor.iVendor}`}
                        title={isExpanded ? 'Hide Connections' : 'Show Connections'}
                        onClick={() => setExpandedId(isExpanded ? null : vendor.iVendor)}
                        className={`p-1.5 rounded-lg transition-colors ${isExpanded ? 'bg-violet-500/15 text-violet-400' : 'hover:bg-muted text-muted-foreground hover:text-foreground'}`}
                      >
                        <Cable className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <VendorConnectionsPanel iVendor={vendor.iVendor} isManagement={isManagement} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-5 py-3 border-t border-border/30 bg-muted/10">
            <p className="text-xs text-muted-foreground">{vendors.length} vendor{vendors.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SippyAccountsTab({ isManagement }: { isManagement: boolean }) {
  const [expandedId, setExpandedId]   = useState<number | null>(null);
  const [lbAccount, setLbAccount]     = useState<{ iAccount: number; username: string } | null>(null);

  const { data, isLoading, refetch } = useQuery<{ accounts: SippyAccount[]; error?: string }>({
    queryKey: ['/api/sippy/accounts'],
    queryFn: () => fetch('/api/sippy/accounts?limit=200').then(r => r.json()),
    staleTime: 30_000,
  });

  const accounts = data?.accounts ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-violet-400" />
            Sippy Accounts
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Accounts on your Sippy switch — SIP registration, auth rules, and low-balance config
          </p>
        </div>
        <button data-testid="button-refresh-sippy-accounts"
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading accounts…
        </div>
      ) : data?.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-6 py-8 flex flex-col items-center gap-3 text-rose-400">
          <AlertTriangle className="w-8 h-8 opacity-50" />
          <p className="text-sm font-medium">{data.error}</p>
          <Link href="/settings" className="mt-1 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs font-medium hover:bg-rose-500/20 transition-colors">
            Go to Settings →
          </Link>
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/60 flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <ShieldCheck className="w-10 h-10 opacity-20" />
          <p className="text-sm">No accounts found on this Sippy switch.</p>
          <p className="text-xs opacity-70">Create an account using the <strong>New Sippy Account</strong> button above.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card/60">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-5 py-2.5 bg-muted/20 border-b border-border/50 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span>Account</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Available</span>
            <span className="text-right">Limit</span>
            <span className="text-center">SIP</span>
            <span className="text-center">Actions</span>
          </div>

          <div className="divide-y divide-border/30">
            {accounts.map(acc => {
              const isExpanded = expandedId === acc.iAccount;
              const reg = acc.registration;
              const availCredits = acc.creditLimit + acc.balance;
              const noCredit = !acc.blocked && !acc.expired && availCredits <= 0;
              return (
                <div key={acc.iAccount} data-testid={`row-sippy-account-${acc.iAccount}`}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-x-4 px-5 py-3.5 hover:bg-muted/10 transition-colors">
                    {/* Account name + badges */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{acc.username}</span>
                        {acc.blocked && (
                          <span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">Blocked</span>
                        )}
                        {acc.expired && (
                          <span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">Expired</span>
                        )}
                        {noCredit && (
                          <span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">No Credit</span>
                        )}
                      </div>
                      {acc.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{acc.description}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">id: {acc.iAccount} · {acc.baseCurrency}</p>
                    </div>

                    {/* Balance */}
                    <div className="text-right">
                      <span className={`text-sm font-mono font-semibold ${acc.balance < 0 ? 'text-rose-400' : acc.balance === 0 ? 'text-muted-foreground' : 'text-emerald-400'}`}>
                        {acc.balance < 0 ? '-' : ''}{acc.baseCurrency} {Math.abs(acc.balance).toFixed(4)}
                      </span>
                    </div>

                    {/* Available credits = creditLimit + balance */}
                    <div className="text-right">
                      <span className={`text-sm font-mono font-semibold ${availCredits <= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {acc.baseCurrency} {availCredits.toFixed(4)}
                      </span>
                    </div>

                    {/* Credit limit */}
                    <div className="text-right">
                      <span className="text-xs text-muted-foreground font-mono">{acc.baseCurrency} {acc.creditLimit.toFixed(2)}</span>
                    </div>

                    {/* SIP registration */}
                    <div className="flex justify-center">
                      {reg?.registered ? (
                        <span title={reg.userAgent ?? 'Registered'} className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 cursor-help">
                          <Wifi className="w-3.5 h-3.5" /> Reg
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                          <WifiOff className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 justify-end">
                      <button data-testid={`button-low-balance-${acc.iAccount}`}
                        title="Low Balance / Auto-Recharge"
                        onClick={() => setLbAccount({ iAccount: acc.iAccount, username: acc.username })}
                        className="p-1.5 rounded-lg hover:bg-violet-500/10 hover:text-violet-400 text-muted-foreground transition-colors"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                      </button>
                      <button data-testid={`button-toggle-auth-rules-${acc.iAccount}`}
                        title={isExpanded ? 'Hide Auth Rules' : 'Show Auth Rules'}
                        onClick={() => setExpandedId(isExpanded ? null : acc.iAccount)}
                        className={`p-1.5 rounded-lg transition-colors ${isExpanded ? 'bg-violet-500/15 text-violet-400' : 'hover:bg-muted text-muted-foreground hover:text-foreground'}`}
                      >
                        <Shield className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Auth rules expandable */}
                  {isExpanded && (
                    <AuthRulesPanel iAccount={acc.iAccount} isManagement={isManagement} />
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-5 py-3 border-t border-border/30 bg-muted/10 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</p>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Info className="w-3 h-3" />
              Balance not inverted in list view — positive = positive balance
            </div>
          </div>
        </div>
      )}

      {/* Low Balance modal */}
      {lbAccount && (
        <LowBalanceModal
          iAccount={lbAccount.iAccount}
          username={lbAccount.username}
          onClose={() => setLbAccount(null)}
        />
      )}
    </div>
  );
}

// ── Sippy codec options (per official docs 107312) ────────────────────────
const CODEC_OPTIONS = [
  { value: 'null', label: 'Disabled (no preference)' },
  { value: '0',   label: 'G.711u (PCMU)' },
  { value: '8',   label: 'G.711a (PCMA)' },
  { value: '18',  label: 'G.729' },
  { value: '9',   label: 'G.722' },
  { value: '3',   label: 'GSM' },
  { value: '4',   label: 'G.723' },
  { value: '15',  label: 'G.728' },
];

// ── New Sippy Account Modal — Multi-Step Wizard ──────────────────────────────
const WIZARD_STEPS = [
  { label: 'Basic Info',     icon: 'user'    },
  { label: 'Network',        icon: 'network' },
  { label: 'SIP Config',     icon: 'sip'     },
  { label: 'Billing',        icon: 'billing' },
];

function NewSippyAccountModal({ onClose, switches }: { onClose: () => void; switches: SwitchOption[] }) {
  const sippySwitches = switches.filter((s: SwitchOption) => s.type === 'sippy');
  const useInlineCreds = sippySwitches.length === 0;

  // Wizard step
  const [step, setStep] = useState(1);

  // Connection
  const [switchId, setSwitchId] = useState<string>('');
  const [inlineUrl, setInlineUrl] = useState('');
  const [inlineUser, setInlineUser] = useState('');
  const [inlinePass, setInlinePass] = useState('');
  const [showInlinePass, setShowInlinePass] = useState(false);

  // Step 1: Basic Info
  const [name, setName] = useState('');
  const [type, setType] = useState<'client' | 'vendor'>('client');
  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fax, setFax] = useState('');
  const [country, setCountry] = useState('');
  const [description, setDescription] = useState('');
  const [username, setUsername] = useState('');
  const [webPassword, setWebPassword] = useState('');
  const [authname, setAuthname] = useState('');
  const [voipPassword, setVoipPassword] = useState('');
  const [showWebPass, setShowWebPass] = useState(false);
  const [showVoipPass, setShowVoipPass] = useState(false);

  // Step 2: Network & Routing
  const [ipTags, setIpTags] = useState<string[]>([]);
  const [ipInput, setIpInput] = useState('');
  const [routingGroupId, setRoutingGroupId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [ratePerMin, setRatePerMin] = useState('');
  const [cliTranslationRule, setCliTranslationRule] = useState('');
  const [cldTranslationRule, setCldTranslationRule] = useState('');
  const [maxSessionTime, setMaxSessionTime] = useState('');

  // Step 3: SIP Configuration
  const [codec, setCodec] = useState('null');
  const [usePreferredCodecOnly, setUsePreferredCodecOnly] = useState(false);
  const [regAllowed, setRegAllowed] = useState(true);
  const [trustCli, setTrustCli] = useState(false);
  const [passPAssertedId, setPassPAssertedId] = useState(false);
  const [pAssrtIdTranslationRule, setPAssrtIdTranslationRule] = useState('');
  const [disallowLoops, setDisallowLoops] = useState(false);
  const [timezone, setTimezone] = useState('');
  const [currency, setCurrency] = useState('');

  // Step 4: Billing & Alerts
  const [creditLimit, setCreditLimit] = useState('');
  const [balance, setBalance] = useState('');
  const [maxSessions, setMaxSessions] = useState('');
  const [maxCps, setMaxCps] = useState('');
  const [lifetime, setLifetime] = useState('-1');
  const [balanceThreshold, setBalanceThreshold] = useState('');
  const [alertEmailTo, setAlertEmailTo] = useState('');
  const [alertEmailCc, setAlertEmailCc] = useState('');

  const [result, setResult] = useState<{
    success: boolean; message: string; detail?: string;
    username?: string; authname?: string; voip_password?: string;
    web_password?: string; portalSubcustomer?: boolean; extraAuthRules?: number;
  } | null>(null);

  const { data: sippySession } = useQuery<{ active: boolean; mode?: string; username?: string }>({
    queryKey: ['/api/sippy/session'],
    staleTime: 30_000,
  });
  const hasActiveSession = !!(sippySession?.active);

  const inlineReady = useInlineCreds && !!inlineUrl.trim() && !!inlineUser.trim() && !!inlinePass.trim();
  const canProceed = !!(switchId || inlineReady || hasActiveSession);

  const switchQs = switchId
    ? `?switchId=${switchId}`
    : inlineReady
      ? `?inlineUrl=${encodeURIComponent(inlineUrl)}&inlineUser=${encodeURIComponent(inlineUser)}&inlinePass=${encodeURIComponent(inlinePass)}`
      : '';

  const { data: rgData } = useQuery<{ groups: { id: number; name: string }[]; error?: string }>({
    queryKey: ['/api/sippy/routing-groups', switchId, inlineUrl, inlineUser],
    queryFn: () => fetch(`/api/sippy/routing-groups${switchQs}`).then(r => r.json()),
    staleTime: 60_000,
    enabled: canProceed,
  });

  const { data: billingPlanData, isLoading: bpLoading } = useQuery<{ plans: { id: number; name: string; currency?: string }[]; error?: string }>({
    queryKey: ['/api/sippy/billing-plans', switchId, inlineUrl, inlineUser],
    queryFn: () => fetch(`/api/sippy/billing-plans${switchQs}`).then(r => r.json()),
    staleTime: 60_000,
    enabled: canProceed,
  });

  const { data: currencyDict } = useQuery<{ entries: { id: string; name: string }[]; error?: string }>({
    queryKey: ['/api/sippy/dictionaries/currencies', switchId, inlineUrl, inlineUser],
    queryFn: () => fetch(`/api/sippy/dictionaries/currencies${switchQs}`).then(r => r.json()),
    staleTime: 5 * 60_000,
    enabled: canProceed,
  });

  const { data: timezoneDict } = useQuery<{ entries: { id: string; name: string }[]; error?: string }>({
    queryKey: ['/api/sippy/dictionaries/timezones', switchId, inlineUrl, inlineUser],
    queryFn: () => fetch(`/api/sippy/dictionaries/timezones${switchQs}`).then(r => r.json()),
    staleTime: 5 * 60_000,
    enabled: canProceed,
  });

  const currencies = currencyDict?.entries ?? [];
  const timezones = timezoneDict?.entries ?? [];
  const routingGroups = rgData?.groups ?? [];
  const billingPlans = billingPlanData?.plans ?? [];

  // IP tag helpers
  const addIpTag = (val: string) => {
    const cleaned = val.trim();
    if (cleaned && !ipTags.includes(cleaned)) setIpTags(prev => [...prev, cleaned]);
    setIpInput('');
  };
  const removeIpTag = (ip: string) => setIpTags(prev => prev.filter(t => t !== ip));
  const handleIpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addIpTag(ipInput); }
    if (e.key === 'Backspace' && !ipInput && ipTags.length) setIpTags(prev => prev.slice(0, -1));
  };

  const createMut = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sippy/accounts', {
      switchId:              switchId ? Number(switchId) : undefined,
      inlineUrl:             useInlineCreds ? inlineUrl  : undefined,
      inlineUser:            useInlineCreds ? inlineUser : undefined,
      inlinePass:            useInlineCreds ? inlinePass : undefined,
      name, type,
      companyName:           companyName     || undefined,
      firstName:             firstName       || undefined,
      lastName:              lastName        || undefined,
      email:                 email           || undefined,
      phone:                 phone           || undefined,
      fax:                   fax             || undefined,
      country:               country         || undefined,
      description:           description     || undefined,
      username:              username        || undefined,
      webPassword:           webPassword     || undefined,
      authname:              authname        || undefined,
      voipPassword:          voipPassword    || undefined,
      ipAddress:             ipTags[0]       || undefined,
      ipAddresses:           ipTags,
      ratePerMin:            ratePerMin      ? Number(ratePerMin)      : undefined,
      routingGroup:          routingGroupId  || undefined,
      servicePlan:           tariffId        || undefined,
      cliTranslationRule:    cliTranslationRule || undefined,
      cldTranslationRule:    cldTranslationRule || undefined,
      maxSessionTime:        maxSessionTime  ? Number(maxSessionTime)  : undefined,
      preferredCodec:        codec === 'null' ? null : Number(codec),
      usePreferredCodecOnly: usePreferredCodecOnly || undefined,
      regAllowed:            regAllowed ? 1 : 0,
      trustCli:              trustCli   ? 1 : 0,
      passPAssertedId:       passPAssertedId || undefined,
      pAssrtIdTranslationRule: pAssrtIdTranslationRule || undefined,
      disallowLoops:         disallowLoops || undefined,
      timezone:              timezone        || undefined,
      currency:              currency        || undefined,
      creditLimit:           creditLimit     ? Number(creditLimit)     : undefined,
      balance:               balance         ? Number(balance)         : undefined,
      maxSessions:           maxSessions     ? Number(maxSessions)     : undefined,
      maxCallsPerSecond:     maxCps          ? Number(maxCps)          : undefined,
      lifetime:              lifetime !== '' ? Number(lifetime)        : undefined,
      balanceThreshold:      balanceThreshold ? Number(balanceThreshold) : undefined,
      alertEmailTo:          alertEmailTo    || undefined,
      alertEmailCc:          alertEmailCc    || undefined,
    }),
    onSuccess: async (res: any) => { const data = await res.json(); setResult(data); },
    onError: (err: any) => {
      const msg = err.message ?? '';
      const json = msg.replace(/^\d+:\s*/, '');
      try { const p = JSON.parse(json); setResult({ success: false, message: p.message ?? msg, detail: p.detail }); }
      catch { setResult({ success: false, message: msg || 'Failed to create account.' }); }
    },
  });

  const fieldCls = "w-full px-3 py-2 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "text-xs font-medium text-muted-foreground mb-1 block";
  const sectionTitle = (t: string) => (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
      <span className="flex-1 h-px bg-border" />{t}<span className="flex-1 h-px bg-border" />
    </p>
  );
  const checkboxRow = (id: string, label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input data-testid={`checkbox-${id}`} type="checkbox" checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 mt-0.5 rounded border-border accent-primary shrink-0" />
      <span className="text-sm leading-tight">{label}{hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}</span>
    </label>
  );

  const canAdvanceStep1 = !!name.trim() && (sippySwitches.length === 0 || !!switchId || hasActiveSession || inlineReady);

  const ResultBanner = result ? (
    <div className={`rounded-lg px-4 py-3 text-sm space-y-2 ${
      result.portalSubcustomer ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
        : result.success ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
        : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
    }`}>
      <div className="flex items-start gap-2">
        {result.success && !result.portalSubcustomer
          ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
        <span data-testid="text-sippy-create-result">
          {result.portalSubcustomer ? (
            <span className="space-y-1.5 block">
              <strong className="block text-amber-200">Portal sub-account created — not a full SIP account</strong>
              <span className="block text-xs text-amber-300/80">
                A sub-account entry was added under your connected portal user, but <strong>this is not a proper Sippy SIP account</strong>.
              </span>
              <span className="block text-xs text-amber-300/80">
                To create real accounts, go to <strong>Settings → Sippy Admin API Credentials</strong> and enter admin credentials.
              </span>
            </span>
          ) : (
            <>
              {result.message}
              {result.detail && <span className="block text-xs mt-1 opacity-80">{result.detail}</span>}
              {result.extraAuthRules && result.extraAuthRules > 0 && (
                <span className="block text-xs mt-1 opacity-80">+ {result.extraAuthRules} extra IP auth rule{result.extraAuthRules > 1 ? 's' : ''} added.</span>
              )}
            </>
          )}
        </span>
      </div>
      {result.success && !result.portalSubcustomer && (result.username || result.authname || result.voip_password) && (
        <div className="mt-2 rounded-md bg-emerald-900/30 border border-emerald-500/20 p-3 space-y-1.5 text-xs">
          <p className="font-semibold text-emerald-300 mb-1">Generated credentials — save these now:</p>
          {result.username     && <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Self-care login:</span><strong className="font-mono">{result.username}</strong></div>}
          {result.web_password && <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Portal password:</span><strong className="font-mono">{result.web_password}</strong></div>}
          {result.authname     && <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">SIP authname:</span><strong className="font-mono">{result.authname}</strong></div>}
          {result.voip_password&& <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">SIP password:</span><strong className="font-mono">{result.voip_password}</strong></div>}
        </div>
      )}
      {result.portalSubcustomer && (
        <div className="mt-2 pt-2 border-t border-amber-500/20">
          <Link to="/settings" onClick={onClose} className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-medium transition-colors">
            Go to Settings → Add Admin API Credentials
          </Link>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col">

        {/* ── Header ── */}
        <div className="bg-card border-b border-border px-6 py-4 flex items-center justify-between rounded-t-2xl shrink-0">
          <div>
            <h3 className="font-semibold text-lg">New Sippy Account</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Create a customer/vendor account on your Sippy switch</p>
          </div>
          <button data-testid="button-close-wizard" onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Step Indicator ── */}
        {!result?.success && !result?.portalSubcustomer && (
          <div className="px-6 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-0">
              {WIZARD_STEPS.map((s, i) => {
                const idx = i + 1;
                const active = step === idx;
                const done   = step > idx;
                return (
                  <div key={idx} className="flex items-center flex-1 min-w-0">
                    <button
                      data-testid={`step-indicator-${idx}`}
                      onClick={() => done ? setStep(idx) : undefined}
                      className={`flex items-center gap-1.5 shrink-0 text-xs font-medium transition-colors ${active ? 'text-primary' : done ? 'text-emerald-400 cursor-pointer hover:text-emerald-300' : 'text-muted-foreground cursor-default'}`}
                    >
                      <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center shrink-0 ${active ? 'bg-primary text-primary-foreground' : done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                        {done ? '✓' : idx}
                      </span>
                      <span className="hidden sm:block truncate">{s.label}</span>
                    </button>
                    {i < WIZARD_STEPS.length - 1 && (
                      <div className={`h-px flex-1 mx-1.5 transition-colors ${done ? 'bg-emerald-500/40' : 'bg-border'}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* ══ STEP 1: Basic Info ══ */}
          {step === 1 && (<>

            {/* Connection */}
            {sippySwitches.length > 0 ? (
              <div>
                <label className={labelCls}>Target Sippy Switch <span className="text-rose-400">*</span></label>
                <select data-testid="select-sippy-switch" value={switchId}
                  onChange={e => { setSwitchId(e.target.value); setRoutingGroupId(''); setTariffId(''); }}
                  className={`${fieldCls} ${!switchId ? 'border-amber-500/50' : ''}`}>
                  <option value="">— Select a Sippy switch —</option>
                  {sippySwitches.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {!switchId && <p className="text-xs text-amber-400 mt-1">Select the Sippy switch to create this account on.</p>}
              </div>
            ) : hasActiveSession ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-4 py-3 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-emerald-300">Connected Sippy session active</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Admin API credentials from Settings will be used.</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/[0.08] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-violet-400" />
                  <span className="text-xs font-semibold text-violet-300 uppercase tracking-wide">Sippy Connection Required</span>
                </div>
                <p className="text-xs text-muted-foreground">Enter Sippy admin credentials, or connect in Settings first.</p>
                <div>
                  <label className={labelCls}>Sippy URL <span className="text-rose-400">*</span></label>
                  <input data-testid="input-sippy-inline-url" value={inlineUrl} onChange={e => setInlineUrl(e.target.value)}
                    placeholder="https://your-sippy-server" className={fieldCls} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Admin Username <span className="text-rose-400">*</span></label>
                    <input data-testid="input-sippy-inline-user" value={inlineUser} onChange={e => setInlineUser(e.target.value)}
                      placeholder="admin" className={fieldCls} autoComplete="off" />
                  </div>
                  <div>
                    <label className={labelCls}>Admin Password <span className="text-rose-400">*</span></label>
                    <div className="relative">
                      <input data-testid="input-sippy-inline-pass" value={inlinePass}
                        type={showInlinePass ? 'text' : 'password'} onChange={e => setInlinePass(e.target.value)}
                        placeholder="••••••••" className={`${fieldCls} pr-8`} autoComplete="off" />
                      <button type="button" onClick={() => setShowInlinePass(p => !p)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showInlinePass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {sectionTitle('Account Identity')}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Display Name <span className="text-rose-400">*</span></label>
                <input data-testid="input-sippy-name" value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. Acme Telecom" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Account Type</label>
                <select data-testid="select-sippy-type" value={type} onChange={e => setType(e.target.value as 'client' | 'vendor')} className={fieldCls}>
                  <option value="client">Client (Customer)</option>
                  <option value="vendor">Vendor (Carrier)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Company Name</label>
                <input data-testid="input-sippy-company" value={companyName} onChange={e => setCompanyName(e.target.value)}
                  placeholder="Optional" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>First Name</label>
                <input data-testid="input-sippy-firstname" value={firstName} onChange={e => setFirstName(e.target.value)}
                  placeholder="Auto-derived" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Last Name</label>
                <input data-testid="input-sippy-lastname" value={lastName} onChange={e => setLastName(e.target.value)}
                  placeholder="Optional" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input data-testid="input-sippy-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="contact@example.com" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Country</label>
                <input data-testid="input-sippy-country" value={country} onChange={e => setCountry(e.target.value)}
                  placeholder="e.g. US" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input data-testid="input-sippy-phone" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+1 555 000 0000" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Fax</label>
                <input data-testid="input-sippy-fax" value={fax} onChange={e => setFax(e.target.value)}
                  placeholder="+1 555 000 0001" className={fieldCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Description</label>
                <input data-testid="input-sippy-description" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Optional notes" className={fieldCls} />
              </div>
            </div>

            {sectionTitle('Portal & SIP Credentials')}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Self-Care Username</label>
                <input data-testid="input-sippy-username" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="Auto-derived from name" className={fieldCls} autoComplete="off" />
                <p className="text-xs text-muted-foreground mt-1">Portal login. Leave blank to auto-derive.</p>
              </div>
              <div>
                <label className={labelCls}>Portal Password</label>
                <div className="relative">
                  <input data-testid="input-sippy-webpass" value={webPassword} onChange={e => setWebPassword(e.target.value)}
                    type={showWebPass ? 'text' : 'password'} placeholder="Auto-generated"
                    className={`${fieldCls} pr-8`} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowWebPass(p => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showWebPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelCls}>SIP Authname</label>
                <input data-testid="input-sippy-authname" value={authname} onChange={e => setAuthname(e.target.value)}
                  placeholder={name ? name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'sipuser' : 'Auto-derived'}
                  className={fieldCls} autoComplete="off" />
                <p className="text-xs text-muted-foreground mt-1">For SIP REGISTER authentication.</p>
              </div>
              <div>
                <label className={labelCls}>SIP Password</label>
                <div className="relative">
                  <input data-testid="input-sippy-voippass" value={voipPassword} onChange={e => setVoipPassword(e.target.value)}
                    type={showVoipPass ? 'text' : 'password'} placeholder="Auto-generated"
                    className={`${fieldCls} pr-8`} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowVoipPass(p => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showVoipPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </>)}

          {/* ══ STEP 2: Network & Routing ══ */}
          {step === 2 && (<>
            {sectionTitle('Client IP Addresses')}
            <div>
              <label className={labelCls}>Allowed IPs <span className="text-muted-foreground">(press Enter or comma to add)</span></label>
              <div className={`${fieldCls} flex flex-wrap gap-1.5 min-h-[40px] cursor-text`}
                onClick={() => document.getElementById('ip-tag-input')?.focus()}>
                {ipTags.map(ip => (
                  <span key={ip} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/15 text-primary text-xs font-mono">
                    {ip}
                    <button type="button" onClick={() => removeIpTag(ip)} className="hover:text-rose-400 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input id="ip-tag-input" data-testid="input-sippy-ip-tags"
                  value={ipInput} onChange={e => setIpInput(e.target.value)}
                  onKeyDown={handleIpKeyDown}
                  onBlur={() => ipInput.trim() && addIpTag(ipInput)}
                  placeholder={ipTags.length === 0 ? 'e.g. 192.168.1.1' : ''}
                  className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Each IP becomes an auth rule (IP-based authentication). Add all SBC/trunk IPs.</p>
            </div>

            {sectionTitle('Routing & Service Plan')}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Routing Group</label>
                {routingGroups.length > 0 ? (
                  <select data-testid="select-sippy-routing" value={routingGroupId} onChange={e => setRoutingGroupId(e.target.value)} className={fieldCls}>
                    <option value="">— Auto-select first —</option>
                    {routingGroups.map(g => <option key={g.id} value={String(g.id)}>{g.name} (#{g.id})</option>)}
                  </select>
                ) : (
                  <input data-testid="input-sippy-routing" value={routingGroupId} onChange={e => setRoutingGroupId(e.target.value)}
                    placeholder="Numeric ID (optional)" type="number" min="1" className={fieldCls} />
                )}
              </div>
              <div>
                <label className={labelCls}>Billing / Service Plan <span className="text-rose-400">*</span></label>
                {bpLoading && canProceed ? (
                  <div className={`${fieldCls} text-muted-foreground flex items-center gap-2`}>
                    <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
                    Loading plans…
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {billingPlans.length > 0 && (
                      <select data-testid="select-sippy-tariff" value={tariffId} onChange={e => setTariffId(e.target.value)} className={fieldCls}>
                        <option value="">— Select a discovered plan —</option>
                        {billingPlans.map(p => <option key={p.id} value={String(p.id)}>{p.name}{p.currency ? ` (${p.currency})` : ''} — #{p.id}</option>)}
                      </select>
                    )}
                    <input data-testid="input-sippy-plan" value={tariffId} onChange={e => setTariffId(e.target.value)}
                      placeholder={billingPlans.length > 0 ? 'Or enter plan ID directly (e.g. 3)' : 'Enter billing plan ID (e.g. 1)'}
                      type="number" min="1" className={fieldCls} />
                    <p className="text-[10px] text-muted-foreground/70">
                      Find IDs in Sippy portal → <em>Customers → Tariffs &amp; Currencies → Service Plans</em>. Each client can have its own plan.
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Rate / Min ($)</label>
                <input data-testid="input-sippy-rate" type="number" step="0.0001" min="0" value={ratePerMin}
                  onChange={e => setRatePerMin(e.target.value)} placeholder="0.0050" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Max Session Time (sec)</label>
                <input data-testid="input-sippy-session-time" type="number" min="0" value={maxSessionTime}
                  onChange={e => setMaxSessionTime(e.target.value)} placeholder="3600 (1 hour)" className={fieldCls} />
              </div>
            </div>

            {sectionTitle('Translation Rules')}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>CLI Translation Rule</label>
                <input data-testid="input-sippy-cli-rule" value={cliTranslationRule} onChange={e => setCliTranslationRule(e.target.value)}
                  placeholder="e.g. s/^/+/" className={fieldCls} />
                <p className="text-xs text-muted-foreground mt-1">Applied to caller-ID (CLI).</p>
              </div>
              <div>
                <label className={labelCls}>CLD Translation Rule</label>
                <input data-testid="input-sippy-cld-rule" value={cldTranslationRule} onChange={e => setCldTranslationRule(e.target.value)}
                  placeholder="e.g. s/^0//" className={fieldCls} />
                <p className="text-xs text-muted-foreground mt-1">Applied to called number (CLD).</p>
              </div>
            </div>
          </>)}

          {/* ══ STEP 3: SIP Configuration ══ */}
          {step === 3 && (<>
            {sectionTitle('Codec & Media')}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Preferred Codec</label>
                <select data-testid="select-sippy-codec" value={codec} onChange={e => setCodec(e.target.value)} className={fieldCls}>
                  {CODEC_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col justify-end pb-0.5">
                {checkboxRow('use-codec-only', 'Use preferred codec only', usePreferredCodecOnly, setUsePreferredCodecOnly, 'Reject calls that cannot use this codec')}
              </div>
            </div>

            {sectionTitle('SIP Behaviour')}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2.5">
                {checkboxRow('sippy-reg', 'Allow SIP Registration', regAllowed, setRegAllowed)}
                {checkboxRow('sippy-trust-cli', 'Trust CLI (caller ID)', trustCli, setTrustCli)}
                {checkboxRow('sippy-disallow-loops', 'Disallow Loop Calls', disallowLoops, setDisallowLoops, 'Reject calls routed back to this account')}
              </div>
              <div className="space-y-2.5">
                {checkboxRow('sippy-p-asserted', 'Pass P-Asserted-Identity', passPAssertedId, setPassPAssertedId)}
              </div>
            </div>

            <div>
              <label className={labelCls}>P-Asserted-ID Translation Rule</label>
              <input data-testid="input-sippy-pai-rule" value={pAssrtIdTranslationRule} onChange={e => setPAssrtIdTranslationRule(e.target.value)}
                placeholder="e.g. s/^/+/" className={fieldCls} />
              <p className="text-xs text-muted-foreground mt-1">Only used when Pass P-Asserted-Identity is enabled.</p>
            </div>

            {sectionTitle('Localisation')}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Currency</label>
                {currencies.length > 0 ? (
                  <select data-testid="select-sippy-currency" value={currency} onChange={e => setCurrency(e.target.value)} className={fieldCls}>
                    <option value="">— Default (USD) —</option>
                    {currencies.map(c => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
                  </select>
                ) : (
                  <input data-testid="input-sippy-currency" value={currency} onChange={e => setCurrency(e.target.value)} placeholder="USD" className={fieldCls} />
                )}
              </div>
              <div>
                <label className={labelCls}>Time Zone</label>
                {timezones.length > 0 ? (
                  <select data-testid="select-sippy-timezone" value={timezone} onChange={e => setTimezone(e.target.value)} className={fieldCls}>
                    <option value="">— Default (UTC) —</option>
                    {timezones.map(tz => <option key={tz.id} value={tz.id}>{tz.name} (#{tz.id})</option>)}
                  </select>
                ) : (
                  <input data-testid="input-sippy-timezone" value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="1 (UTC)" className={fieldCls} />
                )}
              </div>
            </div>
          </>)}

          {/* ══ STEP 4: Billing & Alerts ══ */}
          {step === 4 && (<>
            {sectionTitle('Billing & Limits')}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Credit Limit ($)</label>
                <input data-testid="input-sippy-credit" type="number" min="0" value={creditLimit}
                  onChange={e => setCreditLimit(e.target.value)} placeholder="0 (no limit)" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Starting Balance ($)</label>
                <input data-testid="input-sippy-balance" type="number" min="0" step="0.01" value={balance}
                  onChange={e => setBalance(e.target.value)} placeholder="0.00" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Max Concurrent Sessions</label>
                <input data-testid="input-sippy-sessions" type="number" min="0" value={maxSessions}
                  onChange={e => setMaxSessions(e.target.value)} placeholder="0 (unlimited)" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Max CPS</label>
                <input data-testid="input-sippy-cps" type="number" min="1" value={maxCps}
                  onChange={e => setMaxCps(e.target.value)} placeholder="Unlimited" className={fieldCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Account Lifetime (days)</label>
                <input data-testid="input-sippy-lifetime" type="number" value={lifetime}
                  onChange={e => setLifetime(e.target.value)} placeholder="-1 (unlimited)" className={fieldCls} />
                <p className="text-xs text-muted-foreground mt-1">-1 = unlimited. 0+ = expires in N days from creation.</p>
              </div>
            </div>

            {sectionTitle('Low Balance Alerts')}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Balance Threshold ($)</label>
                <input data-testid="input-sippy-threshold" type="number" min="0" step="0.01" value={balanceThreshold}
                  onChange={e => setBalanceThreshold(e.target.value)} placeholder="e.g. 10.00" className={fieldCls} />
                <p className="text-xs text-muted-foreground mt-1">Send alert when balance drops below this amount. Leave blank to disable.</p>
              </div>
              <div>
                <label className={labelCls}>Alert Email (To)</label>
                <input data-testid="input-sippy-alert-email-to" type="email" value={alertEmailTo}
                  onChange={e => setAlertEmailTo(e.target.value)}
                  placeholder="billing@example.com" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Alert Email (CC)</label>
                <input data-testid="input-sippy-alert-email-cc" type="email" value={alertEmailCc}
                  onChange={e => setAlertEmailCc(e.target.value)}
                  placeholder="manager@example.com" className={fieldCls} />
              </div>
            </div>

            {result && ResultBanner}
          </>)}

        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-border flex items-center gap-3 shrink-0">
          {/* Done / Cancel */}
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">
            {(result?.success || result?.portalSubcustomer) ? 'Close' : 'Cancel'}
          </button>

          <div className="flex-1" />

          {/* Back */}
          {step > 1 && !(result?.success || result?.portalSubcustomer) && (
            <button data-testid="button-wizard-back"
              onClick={() => setStep(s => s - 1)}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors flex items-center gap-1.5">
              ← Back
            </button>
          )}

          {/* Next */}
          {step < 4 && (
            <button data-testid="button-wizard-next"
              disabled={step === 1 && !canAdvanceStep1}
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              Next →
            </button>
          )}

          {/* Create (step 4 only) */}
          {step === 4 && !(result?.success || result?.portalSubcustomer) && (
            <button
              data-testid="button-sippy-create-account"
              disabled={!name.trim() || createMut.isPending}
              onClick={() => createMut.mutate()}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {createMut.isPending ? 'Creating…' : 'Create on Sippy'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const { isManagement } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'profiles' | 'send-rate' | 'sippy' | 'sippy-vendors' | 'live-stats'>('live-stats');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [newSippyOpen, setNewSippyOpen] = useState(false);

  const { data: profiles = [], isLoading } = useQuery<ClientProfile[]>({
    queryKey: ['/api/clients'],
  });
  const { data: allSwitches = [] } = useQuery<SwitchOption[]>({ queryKey: ['/api/switches'] });

  const { data: sippySession } = useQuery<{ active: boolean; username?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
  });

  const { data: portalSession } = useQuery<{ active: boolean; username?: string }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
  });
  const {
    data: vosClientsData,
    isLoading: vosClientsLoading,
    refetch: refetchVosClients,
  } = useQuery<{ clients: VosClient[]; error?: string; source?: string }>({
    queryKey: ['/api/portal/clients'],
    enabled: portalSession?.active === true,
  });

  const importMut = useMutation({
    mutationFn: (vosClient: VosClient) =>
      apiRequest('POST', '/api/clients', {
        name: vosClient.name,
        type: 'client',
        prefix: '',
        ratePerMin: 0.025,
        notes: `Imported from VOS3000 — ID: ${vosClient.id}`,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/clients'] }),
    onSettled: () => setImportingId(null),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/clients', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/clients'] }); setAdding(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest('PATCH', `/api/clients/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/clients'] }); setEditingId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/clients/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/clients'] }),
  });

  const syncMut = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/clients/${id}/sync`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/clients'] }),
  });

  const clients = profiles.filter(p => p.type === 'client');
  const vendors  = profiles.filter(p => p.type === 'vendor');
  const importedNames = new Set(profiles.map(p => p.name));

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Clients &amp; Vendors</h2>
          <p className="text-muted-foreground mt-1">
            Define named parties for reports, and send rates directly to your connected switch.
          </p>
        </div>
        {isManagement && !adding && (
          <div className="flex items-center gap-2">
            {(sippySession?.active || allSwitches.some((s: SwitchOption) => s.type === 'sippy' && s.enabled)) && (tab === 'profiles' || tab === 'sippy' || tab === 'sippy-vendors') && (
              <button
                data-testid="button-new-sippy-account"
                onClick={() => setNewSippyOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Sippy Account
              </button>
            )}
            {tab === 'profiles' && (
              <button
                data-testid="button-add-profile"
                onClick={() => setAdding(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Profile
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit border border-border/50">
        <button
          data-testid="tab-profiles"
          onClick={() => setTab('profiles')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'profiles'
              ? 'bg-card text-foreground shadow-sm border border-border/50'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          Rate Analysis
        </button>
        <button
          data-testid="tab-send-rate"
          onClick={() => setTab('send-rate')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'send-rate'
              ? 'bg-card text-foreground shadow-sm border border-border/50'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          Send Rate
        </button>
        {(sippySession?.active || allSwitches.some((s: SwitchOption) => s.type === 'sippy' && s.enabled)) && (
          <>
            <button
              data-testid="tab-live-stats"
              onClick={() => setTab('live-stats')}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === 'live-stats'
                  ? 'bg-card text-foreground shadow-sm border border-border/50'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              Live Stats
            </button>
            <button
              data-testid="tab-sippy-accounts"
              onClick={() => setTab('sippy')}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === 'sippy'
                  ? 'bg-card text-foreground shadow-sm border border-border/50'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Sippy Accounts
            </button>
            <button
              data-testid="tab-sippy-vendors"
              onClick={() => setTab('sippy-vendors')}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === 'sippy-vendors'
                  ? 'bg-card text-foreground shadow-sm border border-border/50'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              Sippy Vendors
            </button>
          </>
        )}
      </div>

      {tab === 'live-stats' ? (
        <SippyLiveStatsTab />
      ) : tab === 'sippy' ? (
        <SippyAccountsTab isManagement={isManagement} />
      ) : tab === 'sippy-vendors' ? (
        <SippyVendorsTab isManagement={isManagement} />
      ) : tab === 'send-rate' ? (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
            <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <Upload className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h3 className="font-semibold">Send Rate to Switch</h3>
              <p className="text-xs text-muted-foreground">
                Push a rate with effective date/time (GMT+00) to your VOS3000 or Sippy switch
              </p>
            </div>
            {portalSession?.active ? (
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                Switch Connected
              </span>
            ) : (
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Not Connected
              </span>
            )}
          </div>
          {!portalSession?.active && (
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-400 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                Connect to your VOS3000 or Sippy switch in{' '}
                <Link href="/settings" className="underline hover:text-amber-300">Settings</Link>{' '}
                before sending rates.
              </span>
            </div>
          )}
          <SendRatePanel profiles={profiles} />
        </div>
      ) : (
        <>
          {/* Concept explanation */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(Object.entries(TYPE_META) as [string, typeof TYPE_META['client']][]).map(([key, m]) => (
              <div key={key} className={`rounded-xl border p-4 ${m.bg}`}>
                <div className="flex items-center gap-2 mb-2">
                  <m.icon className={`w-4 h-4 ${m.color}`} />
                  <span className={`font-semibold text-sm ${m.color}`}>{m.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {key === 'client'
                    ? 'CLI = the number they call from. Matched by prefix in reports.'
                    : 'CLD = the destination number. Matched by prefix in reports.'}
                </p>
              </div>
            ))}
          </div>

          {/* Add form */}
          {adding && (
            <ProfileForm
              initial={{ ...empty }}
              onSave={(data) => createMut.mutate(data)}
              onCancel={() => setAdding(false)}
              isSaving={createMut.isPending}
            />
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading profiles…
            </div>
          ) : (
            <>
              <ProfileTable
                title="Clients"
                icon={Building2}
                color="text-emerald-400"
                profiles={clients}
                editingId={editingId}
                setEditingId={setEditingId}
                updateMut={updateMut}
                deleteMut={deleteMut}
                syncMut={syncMut}
                isManagement={isManagement}
                emptyNote="No clients yet. Add a client to see their name in ASR/ACD reports."
              />
              <ProfileTable
                title="Vendors / Carriers"
                icon={Server}
                color="text-violet-400"
                profiles={vendors}
                editingId={editingId}
                setEditingId={setEditingId}
                updateMut={updateMut}
                deleteMut={deleteMut}
                syncMut={syncMut}
                isManagement={isManagement}
                emptyNote="No vendors yet. Add a vendor/carrier to track termination destinations."
              />
            </>
          )}

          {/* VOS3000 Terminal Accounts */}
          <div className="rounded-xl border overflow-hidden bg-card/60"
               style={{ borderColor: portalSession?.active ? 'rgb(139 92 246 / 0.3)' : undefined }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
              <div className="flex items-center gap-3">
                <Globe className={`w-4 h-4 ${portalSession?.active ? 'text-violet-400' : 'text-muted-foreground'}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm">VOS3000 Terminal Accounts</h3>
                    {portalSession?.active ? (
                      <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                        Portal Connected
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                        Not Connected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {portalSession?.active
                      ? vosClientsData?.source === 'expenditure-summary'
                        ? 'Client names extracted from your call traffic records'
                        : 'Client accounts configured in your VOS3000 switch'
                      : 'Connect to VOS3000 in Settings to load client accounts from the switch'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {portalSession?.active && (
                  <button
                    data-testid="button-refresh-vos-clients"
                    onClick={() => refetchVosClients()}
                    disabled={vosClientsLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${vosClientsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                )}
                {!portalSession?.active && (
                  <Link href="/settings"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                    Connect
                  </Link>
                )}
              </div>
            </div>

            {!portalSession?.active ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <Globe className="w-8 h-8 opacity-30" />
                <p className="text-sm">Connect to your VOS3000 portal to load terminal accounts.</p>
              </div>
            ) : vosClientsLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading terminal accounts from VOS3000…
              </div>
            ) : vosClientsData?.error ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-amber-400 text-sm text-center px-6">
                <AlertTriangle className="w-5 h-5" />
                <p>{vosClientsData.error}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This can happen if no call data has been recorded yet, or if the portal account lacks list permissions.
                </p>
              </div>
            ) : !vosClientsData?.clients?.length ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                <Building2 className="w-7 h-7 opacity-30" />
                <p>No terminal accounts found on the portal.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {vosClientsData?.source === 'expenditure-summary' && (
                  <div className="flex items-center gap-2 px-6 py-2.5 bg-violet-500/5 border-b border-violet-500/10 text-xs text-violet-300/70">
                    <AlertTriangle className="w-3 h-3 text-violet-400 flex-shrink-0" />
                    Clients derived from call traffic records — direct terminal list not available for this account type
                  </div>
                )}
                {vosClientsData!.clients.map((c) => {
                  const alreadyImported = importedNames.has(c.name);
                  return (
                    <div
                      key={c.id}
                      data-testid={`row-vos-client-${c.id}`}
                      className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Building2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{c.name}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground font-mono">ID: {c.id}</span>
                            {c.type && <span className="text-xs text-muted-foreground">{c.type}</span>}
                            {c.balance !== 0 && (
                              <span className={`text-xs ${c.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                Balance: ${c.balance.toFixed(2)}
                              </span>
                            )}
                            {c.status && (
                              <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                                c.status.toLowerCase().includes('active') || c.status === '1' || c.status === 'enabled'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-muted text-muted-foreground'
                              }`}>
                                {c.status.toLowerCase().includes('active') || c.status === '1' ? 'Active' : c.status}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {isManagement && (
                        alreadyImported ? (
                          <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium px-3 py-1.5">
                            <Check className="w-3.5 h-3.5" />
                            Imported
                          </span>
                        ) : (
                          <button
                            data-testid={`button-import-vos-${c.id}`}
                            onClick={() => { setImportingId(c.id); importMut.mutate(c); }}
                            disabled={importMut.isPending && importingId === c.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/40 text-xs text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-50"
                          >
                            {importMut.isPending && importingId === c.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Download className="w-3 h-3" />
                            }
                            Import
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* New Sippy Account modal */}
      {newSippyOpen && (
        <NewSippyAccountModal
          onClose={() => setNewSippyOpen(false)}
          switches={allSwitches}
        />
      )}
    </div>
  );
}

// ── Profile Table ─────────────────────────────────────────────────────────────

function ProfileTable({
  title, icon: Icon, color, profiles, editingId, setEditingId,
  updateMut, deleteMut, syncMut, isManagement, emptyNote,
}: any) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-border/50 bg-muted/20">
        <Icon className={`w-4 h-4 ${color}`} />
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{profiles.length} profile{profiles.length !== 1 ? 's' : ''}</span>
      </div>
      {profiles.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted-foreground">{emptyNote}</div>
      ) : (
        <div className="divide-y divide-border/30">
          {profiles.map((p: ClientProfile) => (
            <div key={p.id}>
              {editingId === p.id ? (
                <div className="p-4">
                  <ProfileForm
                    initial={p}
                    onSave={(data) => updateMut.mutate({ id: p.id, data })}
                    onCancel={() => setEditingId(null)}
                    isSaving={updateMut.isPending}
                  />
                </div>
              ) : (
                <div
                  data-testid={`row-profile-${p.id}`}
                  className="flex items-start justify-between px-6 py-4 hover:bg-muted/20 transition-colors gap-4"
                >
                  <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2">
                    <div className="lg:col-span-1">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      {p.notes && <p className="text-xs text-muted-foreground truncate">{p.notes}</p>}
                      {p.switchSyncStatus && (
                        <div className="mt-1">
                          <SyncBadge
                            {...resolveSyncStatus(p.switchSyncStatus as any)}
                          />
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Prefix</p>
                      <p className="font-mono text-sm">{p.prefix || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">IP Address</p>
                      <p className="font-mono text-sm">
                        {p.ipAddress
                          ? <span className="text-violet-400">{p.ipAddress}</span>
                          : <span className="text-muted-foreground/50">—</span>
                        }
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Rate / min</p>
                      <p className="text-sm">${(p.ratePerMin ?? 0.025).toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Eff. From (UTC)</p>
                      <p className="text-xs font-mono">
                        {p.rateEffectiveFrom
                          ? <span className="text-emerald-400">{fmtUTC(p.rateEffectiveFrom as any)}</span>
                          : <span className="text-muted-foreground/50">—</span>
                        }
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Expires (UTC)</p>
                      <p className="text-xs font-mono">
                        {p.rateEffectiveTo
                          ? <span className="text-amber-400">{fmtUTC(p.rateEffectiveTo as any)}</span>
                          : <span className="text-muted-foreground/50">No expiry</span>
                        }
                      </p>
                    </div>
                  </div>
                  {isManagement && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        data-testid={`button-sync-${p.id}`}
                        onClick={() => syncMut.mutate(p.id)}
                        disabled={syncMut.isPending}
                        title="Sync to switch"
                        className="p-2 rounded-lg text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-50"
                      >
                        {syncMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        data-testid={`button-edit-profile-${p.id}`}
                        onClick={() => setEditingId(p.id)}
                        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        data-testid={`button-delete-profile-${p.id}`}
                        onClick={() => deleteMut.mutate(p.id)}
                        disabled={deleteMut.isPending}
                        className="p-2 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
