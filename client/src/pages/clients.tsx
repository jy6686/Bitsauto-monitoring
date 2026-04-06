import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Plus, Pencil, Trash2, Loader2, Building2, Server, X, Check,
  Globe, RefreshCw, Download, AlertTriangle, Send, Upload,
  Clock, CalendarClock, CheckCircle2, XCircle, Activity,
  ChevronUp, ChevronDown,
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

function SyncBadge({ status, syncedAt }: { status?: string; syncedAt?: string }) {
  if (!status) return (
    <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">Not synced</span>
  );
  const ok = status === 'synced';
  return (
    <span title={syncedAt ? `Last sync: ${fmtUTC(syncedAt)}` : undefined}
      className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${
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
                  status={selected.switchSyncStatus.vos3000 || selected.switchSyncStatus.sippy}
                  syncedAt={selected.switchSyncStatus.syncedAt}
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const { isManagement } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'profiles' | 'send-rate'>('profiles');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  const { data: profiles = [], isLoading } = useQuery<ClientProfile[]>({
    queryKey: ['/api/clients'],
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
        {isManagement && tab === 'profiles' && !adding && (
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
      </div>

      {tab === 'send-rate' ? (
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
                            status={p.switchSyncStatus.vos3000 || p.switchSyncStatus.sippy}
                            syncedAt={p.switchSyncStatus.syncedAt}
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
