import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Phone, Scissors, Clock, RefreshCw, Plus, Pencil, Trash2,
  CheckCircle2, XCircle, AlertTriangle, Wifi, WifiOff, FileAudio,
  Activity, Copy, ChevronLeft, ChevronRight, Settings2, ScrollText, Zap, Info,
  Play, Pause, Volume2, Download, X, BarChart2, TrendingDown, Hash,
  PauseCircle, Archive, RotateCcw, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────────

interface GovernanceRule {
  id: number;
  ruleName: string | null;
  connectionName: string;
  channelPattern: string | null;
  destinationPrefix: string | null;
  callerPrefix: string | null;
  capSec: number;
  jitterSec: number;
  enabled: boolean;
  action: string;
  scenario: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface GovernedCall {
  id: number;
  uniqueId: string | null;
  channelA: string | null;
  channelB: string | null;
  caller: string | null;
  callee: string | null;
  connectionName: string | null;
  ruleId: number | null;
  capSec: number | null;
  startTime: string | null;
  byeSentAt: string | null;
  playbackStartedAt: string | null;
  completedAt: string | null;
  recordingPath: string | null;
  triggerReason: string | null;
  status: string;
  elapsedSec: number | null;
  remainingSec: number | null;
}

interface GovernanceLog {
  id: number;
  governedCallId: number | null;
  eventType: string;
  channel: string | null;
  details: string | null;
  createdAt: string;
}

interface ProductPrefix {
  id: number;
  canonicalId: number;
  productCode: string;
  productName: string;
  fullPrefix: string;
  status: string;
  createdAt: string;
}

interface VendorEntry {
  id: number;
  name: string;
  vendorPrefix: string;
  description: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  prefixes: ProductPrefix[];
}

interface PrefixAuditEntry {
  id: number;
  action: string;
  canonicalId: number | null;
  vendorName: string | null;
  fullPrefix: string | null;
  performedBy: string | null;
  details: any;
  createdAt: string;
}

interface Stats {
  active: number;
  cutsToday: number;
  totalToday: number;
  amiOnline: boolean;
}

interface BillingRow {
  id: number;
  caller: string | null;
  callee: string | null;
  connectionName: string | null;
  capSec: number | null;
  triggerReason: string | null;
  startTime: string | null;
  byeSentAt: string | null;
  govSec: number | null;
  estimatedBilledSec: number | null;
  customerBilledSec: number | null;
  customerCost: number | null;
  vendorCost: number | null;
  marginAmount: number | null;
  vendorName: string | null;
  status: 'ok' | 'check' | 'loss' | 'no_cdr';
  cdrCheckedAt: string | null;
  cdrSource: 'db' | 'live' | null;
  vendorCallId: string | null;
  vendorIp: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtSec(s: number | null) {
  if (s === null || s === undefined) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${r}s` : `${r}s`;
}

function fmtTs(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString();
}

function fmtDate(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "Active",     color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
  cut:       { label: "Cut",        color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/25"   },
  completed: { label: "Completed",  color: "text-slate-400",   bg: "bg-slate-500/10 border-slate-500/20"   },
  failed:    { label: "Failed",     color: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/25"     },
};

const EVENT_ICONS: Record<string, any> = {
  call_bridged:      Activity,
  vendor_bye:        Scissors,
  playback_started:  FileAudio,
  call_ended:        XCircle,
  error:             AlertTriangle,
};

// ── Countdown timer component ──────────────────────────────────────────────────

function Countdown({ startTime, capSec }: { startTime: string | null; capSec: number | null }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!startTime || !capSec) return;
    function calc() {
      const elapsed = (Date.now() - new Date(startTime!).getTime()) / 1000;
      setRemaining(Math.max(0, Math.round(capSec! - elapsed)));
    }
    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [startTime, capSec]);

  if (remaining === null) return <span className="text-slate-500">—</span>;
  const pct = capSec ? Math.max(0, remaining / capSec) : 0;
  const color = pct > 0.5 ? "text-emerald-400" : pct > 0.2 ? "text-amber-400" : "text-rose-400";
  return (
    <span className={cn("font-mono font-bold text-sm", color)} data-testid="countdown-timer">
      {fmtSec(remaining)}
    </span>
  );
}

// ── Inline Audio Player ────────────────────────────────────────────────────────

function AudioPlayer({ path, callId }: { path: string; callId: number }) {
  const audioRef              = useRef<HTMLAudioElement>(null);
  const [srcSet, setSrcSet]   = useState(false);   // lazy — only load on first play click
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError]       = useState<string | null>(null);

  const src = `/api/call-governance/recordings/stream?path=${encodeURIComponent(path)}`;

  function toggle() {
    const a = audioRef.current;
    if (!a) return;

    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }

    // First click — set src, then play once loaded
    if (!srcSet) {
      setLoading(true);
      setError(null);
      setSrcSet(true);
      a.src = src;
      a.load();
      a.play().catch(e => { setError('Not found'); setLoading(false); setPlaying(false); });
      setPlaying(true);
    } else {
      a.play().catch(e => { setError(e.message); setPlaying(false); });
      setPlaying(true);
    }
  }

  function onTimeUpdate() {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    setProgress((a.currentTime / a.duration) * 100);
  }

  function onLoaded() {
    setDuration(audioRef.current?.duration ?? 0);
    setLoading(false);
    setError(null);
  }

  function onEnded() { setPlaying(false); setProgress(100); }

  function onErr() {
    setLoading(false);
    setPlaying(false);
    setError('Not found on Asterisk');
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
  }

  function fmt(s: number) {
    if (!s || isNaN(s)) return '—';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  return (
    <div className="flex items-center gap-2 min-w-0" data-testid={`audio-player-${callId}`}>
      {/* audio element — no src until first click */}
      <audio ref={audioRef} preload="none"
        onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoaded}
        onEnded={onEnded} onError={onErr}
      />

      {error ? (
        <>
          <button
            data-testid={`button-play-${callId}`}
            onClick={() => { setError(null); setSrcSet(false); setProgress(0); setDuration(0); }}
            title="Retry"
            className="w-6 h-6 rounded-full bg-rose-600/40 hover:bg-rose-600/70 flex items-center justify-center flex-shrink-0 transition-colors"
          >
            <RefreshCw className="w-3 h-3 text-rose-300" />
          </button>
          <span className="text-xs text-rose-400 truncate">{error}</span>
        </>
      ) : (
        <>
          <button
            data-testid={`button-play-${callId}`}
            onClick={toggle}
            disabled={loading}
            className="w-6 h-6 rounded-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 flex items-center justify-center flex-shrink-0 transition-colors"
          >
            {loading
              ? <RefreshCw className="w-3 h-3 text-white animate-spin" />
              : playing
                ? <Pause className="w-3 h-3 text-white" />
                : <Play  className="w-3 h-3 text-white ml-0.5" />}
          </button>

          <div
            className="flex-1 h-1.5 bg-slate-700 rounded-full cursor-pointer min-w-[60px] max-w-[120px]"
            onClick={seek}
            data-testid={`seek-bar-${callId}`}
          >
            <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>

          <span className="text-xs text-slate-500 font-mono flex-shrink-0">{fmt(duration)}</span>

          <a href={src} download data-testid={`button-download-${callId}`}
            className="text-slate-500 hover:text-slate-300 flex-shrink-0" title="Download WAV">
            <Download className="w-3 h-3" />
          </a>
        </>
      )}
    </div>
  );
}

// ── Blank-state component ──────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <div className="w-14 h-14 rounded-xl bg-slate-800 flex items-center justify-center">
        <Icon className="w-7 h-7 text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-300">{title}</p>
      <p className="text-xs text-slate-500 max-w-xs">{desc}</p>
    </div>
  );
}

// ── Rule form (add / edit) ─────────────────────────────────────────────────────

function RuleForm({
  initial, onSave, onCancel,
}: {
  initial?: Partial<GovernanceRule>;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    ruleName:          initial?.ruleName          ?? "",
    connectionName:    initial?.connectionName    ?? "",
    channelPattern:    initial?.channelPattern    ?? "",
    destinationPrefix: initial?.destinationPrefix ?? "",
    callerPrefix:      initial?.callerPrefix      ?? "",
    capSec:            String(initial?.capSec    ?? 120),
    jitterSec:         String(initial?.jitterSec ?? 15),
    enabled:           initial?.enabled ?? false,
    action:            initial?.action  ?? "cap_and_replay",
    notes:             initial?.notes   ?? "",
  });

  function set(k: string, v: any) { setForm(p => ({ ...p, [k]: v })); }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 space-y-4" data-testid="rule-form">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs text-slate-400">Rule Name</label>
          <Input
            data-testid="input-rule-name"
            value={form.ruleName}
            onChange={e => set('ruleName', e.target.value)}
            placeholder="e.g. Pakistan Charlie OTP"
            className="bg-slate-900/50 border-slate-700"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-400">Connection Name <span className="text-rose-400">*</span></label>
          <Input
            data-testid="input-connection-name"
            value={form.connectionName}
            onChange={e => set('connectionName', e.target.value)}
            placeholder="e.g. Sippy"
            className="bg-slate-900/50 border-slate-700"
          />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs text-slate-400">Channel Pattern (regex matching vendor/B-leg)</label>
          <Input
            data-testid="input-channel-pattern"
            value={form.channelPattern}
            onChange={e => set('channelPattern', e.target.value)}
            placeholder="e.g. ^SIP/sippy"
            className="bg-slate-900/50 border-slate-700"
          />
          <p className="text-xs text-slate-500">Regex matched against Asterisk channel name. Matching channel = vendor leg (to cut).</p>
        </div>

        {/* ── Destination-based matching ── */}
        <div className="space-y-1">
          <label className="text-xs text-slate-400">Destination Prefix</label>
          <Input
            data-testid="input-destination-prefix"
            value={form.destinationPrefix}
            onChange={e => set('destinationPrefix', e.target.value)}
            placeholder="e.g. 291 (Eritrea), 923 (Pakistan)"
            className="bg-slate-900/50 border-slate-700"
          />
          <p className="text-xs text-slate-500">CLD starts-with match. Leave blank = all destinations (catch-all).</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-400">Caller Prefix <span className="text-slate-600">(optional)</span></label>
          <Input
            data-testid="input-caller-prefix"
            value={form.callerPrefix}
            onChange={e => set('callerPrefix', e.target.value)}
            placeholder="e.g. 206092 (OTP product routing)"
            className="bg-slate-900/50 border-slate-700"
          />
          <p className="text-xs text-slate-500">CLI starts-with match. Use to separate OTP vs CC on same destination.</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-400">Cap (seconds)</label>
          <Input
            data-testid="input-cap-sec"
            type="number" min={1} max={3600}
            value={form.capSec}
            onChange={e => set('capSec', e.target.value)}
            className="bg-slate-900/50 border-slate-700"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-400">Jitter (seconds)</label>
          <Input
            data-testid="input-jitter-sec"
            type="number" min={0} max={60}
            value={form.jitterSec}
            onChange={e => set('jitterSec', e.target.value)}
            className="bg-slate-900/50 border-slate-700"
          />
          <p className="text-xs text-slate-500">Random 0–N seconds added to cap to prevent pattern detection.</p>
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs text-slate-400">Notes</label>
          <Textarea
            data-testid="input-notes"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Optional notes..."
            rows={2}
            className="bg-slate-900/50 border-slate-700 resize-none"
          />
        </div>
        <div className="col-span-2 flex items-center gap-3">
          <Switch
            data-testid="toggle-enabled"
            checked={form.enabled}
            onCheckedChange={v => set('enabled', v)}
          />
          <span className="text-sm text-slate-300">Rule enabled</span>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button
          data-testid="button-save-rule"
          onClick={() => onSave({
            ...form,
            destinationPrefix: form.destinationPrefix.trim() || null,
            callerPrefix:      form.callerPrefix.trim()      || null,
            ruleName:          form.ruleName.trim()          || null,
            capSec:            Number(form.capSec),
            jitterSec:         Number(form.jitterSec),
          })}
          disabled={!form.connectionName.trim()}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          Save Rule
        </Button>
        <Button data-testid="button-cancel-rule" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'live',      label: 'Live Calls',      icon: Activity  },
  { id: 'rules',     label: 'Rules',           icon: Settings2 },
  { id: 'recordings',label: 'Recordings',      icon: FileAudio },
  { id: 'log',       label: 'Audit Log',       icon: ScrollText },
  { id: 'billing',   label: 'Billing Check',   icon: BarChart2 },
  { id: 'prefixes',  label: 'Prefix Registry', icon: Hash      },
] as const;

type Tab = typeof TABS[number]['id'];

export default function CallGovernancePage() {
  const [tab, setTab]         = useState<Tab>('live');
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState<GovernanceRule | null>(null);
  const [billingPage, setBillingPage] = useState(1);
  const { toast } = useToast();
  const qc = useQueryClient();

  const BILLING_PAGE_SIZE = 100;

  useEffect(() => { setBillingPage(1); }, [tab]);

  const statsQ = useQuery<Stats>({
    queryKey: ['/api/call-governance/stats'],
    refetchInterval: 5_000,
  });

  const callsQ = useQuery<GovernedCall[]>({
    queryKey: ['/api/call-governance/calls'],
    refetchInterval: tab === 'live' ? 3_000 : 30_000,
  });

  const rulesQ = useQuery<GovernanceRule[]>({
    queryKey: ['/api/call-governance/rules'],
    enabled: tab === 'rules',
  });

  const logQ = useQuery<GovernanceLog[]>({
    queryKey: ['/api/call-governance/log'],
    enabled: tab === 'log',
    refetchInterval: tab === 'log' ? 10_000 : false,
  });

  const billingQ = useQuery<BillingRow[]>({
    queryKey: ['/api/call-governance/billing'],
    enabled: tab === 'billing',
    // Poll fast (10s) while there are No CDR entries — CDRs appear within 5 min of the cut.
    // Backs off to 30s once everything is resolved.
    refetchInterval: (query) => {
      if (tab !== 'billing') return false;
      const hasPending = (query.state.data as BillingRow[] | undefined)?.some(r => r.status === 'no_cdr');
      return hasPending ? 10_000 : 30_000;
    },
  });

  const retryCdrMut = useMutation({
    mutationFn: (id?: number) => apiRequest('POST', '/api/call-governance/billing-backfill', id != null ? { id } : {}),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['/api/call-governance/billing'] });
      toast({ title: `CDR lookup queued`, description: `${data?.queued ?? 1} cut(s) queued — results appear in ~5 s` });
    },
    onError: (e: any) => toast({ title: 'Retry failed', description: e.message, variant: 'destructive' }),
  });

  const addRuleMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/call-governance/rules', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/call-governance/rules'] }); setShowForm(false); toast({ title: 'Rule created' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const editRuleMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest('PATCH', `/api/call-governance/rules/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/call-governance/rules'] }); setEditRule(null); toast({ title: 'Rule updated' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const delRuleMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/call-governance/rules/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/call-governance/rules'] }); toast({ title: 'Rule deleted' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const cutMut = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/call-governance/calls/${id}/cut`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/call-governance/calls'] }); toast({ title: 'Vendor leg cut', description: 'BYE sent to vendor channel' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // ── Prefix Registry state ────────────────────────────────────────────────────
  const [prefixView, setPrefixView]             = useState<'vendors'|'audit'>('vendors');
  const [showRegForm, setShowRegForm]           = useState(false);
  const [newVendorName, setNewVendorName]       = useState('');
  const [newVendorDesc, setNewVendorDesc]       = useState('');
  const [expandedVendorId, setExpandedVendorId] = useState<number | null>(null);
  const [prefixSearch, setPrefixSearch]         = useState('');

  const vendorsQ = useQuery<VendorEntry[]>({
    queryKey: ['/api/prefix-registry/vendors'],
    enabled: tab === 'prefixes',
    refetchInterval: tab === 'prefixes' ? 30_000 : false,
  });

  const prefixAuditQ = useQuery<PrefixAuditEntry[]>({
    queryKey: ['/api/prefix-registry/audit'],
    enabled: tab === 'prefixes' && prefixView === 'audit',
  });

  const registerVendorMut = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      apiRequest('POST', '/api/prefix-registry/vendors', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/prefix-registry/vendors'] });
      qc.invalidateQueries({ queryKey: ['/api/prefix-registry/audit'] });
      setShowRegForm(false); setNewVendorName(''); setNewVendorDesc('');
      toast({ title: 'Vendor registered', description: 'Prefix block auto-assigned' });
    },
    onError: (e: any) => toast({ title: 'Registration failed', description: e.message, variant: 'destructive' }),
  });

  const vendorStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest('PATCH', `/api/prefix-registry/vendors/${id}/status`, { status }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['/api/prefix-registry/vendors'] });
      qc.invalidateQueries({ queryKey: ['/api/prefix-registry/audit'] });
      toast({ title: `Vendor ${v.status}`, description: 'Status and all prefixes updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const prefixStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest('PATCH', `/api/prefix-registry/prefixes/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/prefix-registry/vendors'] });
      toast({ title: 'Prefix status updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const stats   = statsQ.data;
  const calls   = callsQ.data   ?? [];
  const rules   = rulesQ.data   ?? [];
  const logData = logQ.data     ?? [];

  const activeCalls    = calls.filter(c => c.status === 'active');
  const recentCalls    = calls.filter(c => c.status !== 'active').slice(0, 50);
  const recordingCalls = calls.filter(c => !!c.recordingPath);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Shield className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Call Governance</h1>
            <p className="text-xs text-slate-400">AMI-triggered vendor leg cut + 120s recording replay</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="ami-status-badge"
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium",
              stats?.amiOnline
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                : "bg-slate-700/50 border-slate-600 text-slate-400"
            )}
          >
            {stats?.amiOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            AMI {stats?.amiOnline ? 'Online' : 'Offline'}
          </span>
          <Button
            data-testid="button-refresh"
            variant="ghost" size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ['/api/call-governance'] })}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active Now',   value: stats?.active     ?? '—', color: 'text-emerald-400', icon: Phone    },
          { label: 'Cuts Today',   value: stats?.cutsToday  ?? '—', color: 'text-amber-400',   icon: Scissors },
          { label: 'Total Today',  value: stats?.totalToday ?? '—', color: 'text-blue-400',    icon: Activity },
        ].map(k => (
          <div key={k.label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center gap-3" data-testid={`kpi-${k.label.toLowerCase().replace(/\s/g,'-')}`}>
            <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
              <k.icon className={cn("w-4.5 h-4.5", k.color)} />
            </div>
            <div>
              <div className={cn("text-xl font-bold", k.color)}>{k.value}</div>
              <div className="text-xs text-slate-500">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t.id
                ? "bg-violet-600 text-white shadow"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Live ─────────────────────────────────────────────────────── */}
      {tab === 'live' && (
        <div className="space-y-5">
          {/* Active calls */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-medium text-slate-200">Active Governed Calls</span>
              <span className="text-xs text-slate-500 ml-auto">{activeCalls.length} call{activeCalls.length !== 1 ? 's' : ''}</span>
            </div>
            {callsQ.isLoading ? (
              <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : activeCalls.length === 0 ? (
              <EmptyState icon={Phone} title="No active governed calls" desc="Governed calls appear here when Asterisk Bridge events are received matching a governance rule." />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-900/40 border-b border-slate-800">
                  <tr>
                    {['Caller → Callee','Connection','Vendor Channel','Elapsed','Remaining','Action'].map(h => (
                      <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {activeCalls.map(c => (
                    <tr key={c.id} className="hover:bg-slate-800/20" data-testid={`row-active-call-${c.id}`}>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        <span className="text-slate-200">{c.caller || '?'}</span>
                        <span className="text-slate-500 mx-1">→</span>
                        <span className="text-slate-200">{c.callee || '?'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-300">{c.connectionName || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-400 max-w-[200px] truncate">{c.channelB || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-400">{fmtSec(c.elapsedSec)}</td>
                      <td className="px-4 py-2.5">
                        <Countdown startTime={c.startTime} capSec={c.capSec} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Button
                          data-testid={`button-cut-${c.id}`}
                          size="sm" variant="outline"
                          className="h-6 px-2 text-xs border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                          onClick={() => cutMut.mutate(c.id)}
                          disabled={cutMut.isPending}
                        >
                          <Scissors className="w-3 h-3 mr-1" /> Cut Now
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent completed */}
          {recentCalls.length > 0 && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <span className="text-sm font-medium text-slate-200">Recent Governed Calls</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-900/40 border-b border-slate-800">
                  <tr>
                    {['Caller → Callee','Connection','Status','Trigger','Cap','Cut At','Recording'].map(h => (
                      <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {recentCalls.map(c => {
                    const s = STATUS_CFG[c.status] ?? STATUS_CFG.completed;
                    return (
                      <tr key={c.id} className="hover:bg-slate-800/20" data-testid={`row-recent-call-${c.id}`}>
                        <td className="px-4 py-2 font-mono text-xs">
                          <span className="text-slate-300">{c.caller || '?'}</span>
                          <span className="text-slate-500 mx-1">→</span>
                          <span className="text-slate-300">{c.callee || '?'}</span>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-400">{c.connectionName || '—'}</td>
                        <td className="px-4 py-2">
                          <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", s.bg, s.color)}>{s.label}</span>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-400 capitalize">{c.triggerReason?.replace('_', ' ') || '—'}</td>
                        <td className="px-4 py-2 text-xs text-slate-400">{c.capSec ? `${c.capSec}s` : '—'}</td>
                        <td className="px-4 py-2 text-xs text-slate-400">{fmtTs(c.byeSentAt)}</td>
                        <td className="px-4 py-2">
                          {c.recordingPath
                            ? <AudioPlayer path={c.recordingPath} callId={c.id} />
                            : <span className="text-slate-600 text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Rules ────────────────────────────────────────────────────── */}
      {tab === 'rules' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">
              Rules match calls by channel pattern, destination prefix, and caller prefix. The most specific matching rule wins. Catch-all rules (no prefix) apply when no specific rule matches.
            </p>
            {!showForm && !editRule && (
              <Button
                data-testid="button-add-rule"
                onClick={() => setShowForm(true)}
                className="bg-violet-600 hover:bg-violet-700 text-white gap-2"
              >
                <Plus className="w-3.5 h-3.5" /> Add Rule
              </Button>
            )}
          </div>

          {/* Add form */}
          {showForm && (
            <RuleForm
              onSave={data => addRuleMut.mutate(data)}
              onCancel={() => setShowForm(false)}
            />
          )}

          {rulesQ.isLoading ? (
            <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
          ) : rules.length === 0 && !showForm ? (
            <EmptyState icon={Settings2} title="No governance rules yet" desc="Add a rule to start governing calls by Sippy connection. Each rule maps a connection to a cap timer." />
          ) : (
            <div className="space-y-3">
              {rules.map(rule => (
                <div key={rule.id} data-testid={`card-rule-${rule.id}`}>
                  {editRule?.id === rule.id ? (
                    <RuleForm
                      initial={rule}
                      onSave={data => editRuleMut.mutate({ id: rule.id, data })}
                      onCancel={() => setEditRule(null)}
                    />
                  ) : (
                    <div className={cn(
                      "bg-slate-900/60 border rounded-xl p-4",
                      rule.enabled ? "border-violet-500/30" : "border-slate-800"
                    )}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn(
                            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                            rule.enabled ? "bg-violet-500/15" : "bg-slate-800"
                          )}>
                            <Shield className={cn("w-4 h-4", rule.enabled ? "text-violet-400" : "text-slate-500")} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-slate-100">
                                {rule.ruleName || rule.connectionName}
                              </span>
                              {rule.ruleName && (
                                <span className="text-xs text-slate-500 font-normal">{rule.connectionName}</span>
                              )}
                              <span className={cn(
                                "text-xs px-2 py-0.5 rounded-full border font-medium",
                                rule.enabled
                                  ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                                  : "bg-slate-700/50 border-slate-600 text-slate-500"
                              )}>
                                {rule.enabled ? 'Enabled' : 'Disabled'}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-slate-400">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Cap: <strong className="text-slate-200">{rule.capSec}s</strong>
                              </span>
                              <span className="flex items-center gap-1">
                                <Zap className="w-3 h-3" /> Jitter: <strong className="text-slate-200">±{rule.jitterSec}s</strong>
                              </span>
                              {rule.destinationPrefix && (
                                <span className="flex items-center gap-1">
                                  <ChevronRight className="w-3 h-3" />
                                  Dest: <code className="text-amber-300 font-mono">{rule.destinationPrefix}*</code>
                                </span>
                              )}
                              {rule.callerPrefix && (
                                <span className="flex items-center gap-1">
                                  <ChevronRight className="w-3 h-3" />
                                  CLI: <code className="text-sky-300 font-mono">{rule.callerPrefix}*</code>
                                </span>
                              )}
                              {!rule.destinationPrefix && !rule.callerPrefix && (
                                <span className="flex items-center gap-1 text-slate-500">
                                  <ChevronRight className="w-3 h-3" /> All destinations (catch-all)
                                </span>
                              )}
                              {rule.channelPattern && (
                                <span className="font-mono flex items-center gap-1">
                                  <ChevronRight className="w-3 h-3" /> Pattern: <code className="text-violet-300">{rule.channelPattern}</code>
                                </span>
                              )}
                            </div>
                            {rule.notes && (
                              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                <Info className="w-3 h-3" /> {rule.notes}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Switch
                            data-testid={`toggle-rule-${rule.id}`}
                            checked={rule.enabled}
                            onCheckedChange={v => editRuleMut.mutate({ id: rule.id, data: { enabled: v } })}
                          />
                          <Button
                            data-testid={`button-edit-rule-${rule.id}`}
                            variant="ghost" size="icon"
                            className="w-7 h-7 text-slate-400 hover:text-slate-200"
                            onClick={() => setEditRule(rule)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            data-testid={`button-delete-rule-${rule.id}`}
                            variant="ghost" size="icon"
                            className="w-7 h-7 text-rose-400/60 hover:text-rose-400"
                            onClick={() => delRuleMut.mutate(rule.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Info card */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex gap-3">
            <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-slate-400 space-y-1">
              <p className="font-medium text-blue-300">How it works</p>
              <p>When Asterisk bridges a call matching the channel pattern, BitsAuto starts a timer (cap ± random jitter). At expiry, an AMI Hangup is sent to the vendor channel (B-leg). The customer channel (A-leg) is then redirected to the <code className="text-violet-300">gov-playback</code> context to hear the recorded 120s segment.</p>
              <p className="mt-1">Asterisk must have MixMonitor active in the <code className="text-violet-300">[sippy-media-anchor]</code> context and the <code className="text-violet-300">gov-playback</code> context configured in its dialplan.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Recordings ───────────────────────────────────────────────── */}
      {tab === 'recordings' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Recording paths written by Asterisk MixMonitor. Files are stored on the Asterisk server at <code className="text-xs text-violet-300">/var/spool/asterisk/monitor/</code>.
          </p>
          {callsQ.isLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
          ) : recordingCalls.length === 0 ? (
            <EmptyState icon={FileAudio} title="No recordings yet" desc="Recording paths appear here once governed calls have been bridged through Asterisk with MixMonitor active." />
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/40 border-b border-slate-800">
                  <tr>
                    {['Call','Caller → Callee','Connection','Cap','Status','Started','Recording Path'].map(h => (
                      <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {recordingCalls.map(c => {
                    const s = STATUS_CFG[c.status] ?? STATUS_CFG.completed;
                    return (
                      <tr key={c.id} className="hover:bg-slate-800/20" data-testid={`row-recording-${c.id}`}>
                        <td className="px-4 py-2.5 text-xs text-slate-400">#{c.id}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          <span className="text-slate-300">{c.caller || '?'}</span>
                          <span className="text-slate-500 mx-1">→</span>
                          <span className="text-slate-300">{c.callee || '?'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400">{c.connectionName || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-400">{c.capSec}s</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", s.bg, s.color)}>{s.label}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400">{fmtDate(c.startTime)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-1.5">
                            <AudioPlayer path={c.recordingPath!} callId={c.id} />
                            <div className="flex items-center gap-1">
                              <code className="text-xs text-slate-500 font-mono truncate max-w-[200px]">{c.recordingPath}</code>
                              <button
                                data-testid={`button-copy-path-${c.id}`}
                                onClick={() => { navigator.clipboard.writeText(c.recordingPath!); toast({ title: 'Path copied' }); }}
                                className="text-slate-600 hover:text-slate-400 flex-shrink-0"
                                title="Copy path"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Billing Check ────────────────────────────────────────────── */}
      {tab === 'billing' && (
        <div className="space-y-4">
          {/* Summary cards */}
          {billingQ.data && billingQ.data.length > 0 && (() => {
            const rows  = billingQ.data;
            const ok    = rows.filter(r => r.status === 'ok').length;
            const loss  = rows.filter(r => r.status === 'loss').length;
            const check = rows.filter(r => r.status === 'check').length;
            const noCdr = rows.filter(r => r.status === 'no_cdr').length;
            const totalLoss = rows.reduce((s, r) =>
              r.status === 'loss' && r.marginAmount != null ? s + Math.abs(r.marginAmount) : s, 0);
            return (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">Total Governed</p>
                  <p className="text-2xl font-bold text-slate-100" data-testid="billing-total">{rows.length}</p>
                </div>
                <div className="bg-emerald-950/40 border border-emerald-900/40 rounded-xl p-4">
                  <p className="text-xs text-emerald-400 mb-1">✓ OK (no loss)</p>
                  <p className="text-2xl font-bold text-emerald-300" data-testid="billing-ok">{ok}</p>
                </div>
                <div className={`rounded-xl p-4 border ${loss > 0 ? 'bg-rose-950/40 border-rose-900/40' : 'bg-slate-900/60 border-slate-800'}`}>
                  <p className={`text-xs mb-1 ${loss > 0 ? 'text-rose-400' : 'text-slate-500'}`}>↓ Loss (vendor &gt; revenue)</p>
                  <p className={`text-2xl font-bold ${loss > 0 ? 'text-rose-300' : 'text-slate-400'}`} data-testid="billing-loss">{loss}</p>
                  {loss > 0 && <p className="text-[10px] text-rose-500/70 mt-1">−${totalLoss.toFixed(4)} total</p>}
                </div>
                <div className="bg-amber-950/40 border border-amber-900/40 rounded-xl p-4">
                  <p className="text-xs text-amber-400 mb-1">⚠ Check (overbilled)</p>
                  <p className="text-2xl font-bold text-amber-300" data-testid="billing-check">{check}</p>
                </div>
                <div className={`rounded-xl p-4 border ${noCdr > 0 ? 'bg-sky-950/30 border-sky-800/40' : 'bg-slate-900/60 border-slate-800'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-xs ${noCdr > 0 ? 'text-sky-400' : 'text-slate-500'}`}>
                      {noCdr > 0 ? '⟳ Checking CDRs…' : 'No CDR yet'}
                    </p>
                    {noCdr > 0 && (
                      <button
                        onClick={() => billingQ.refetch()}
                        disabled={billingQ.isFetching}
                        className="text-sky-400 hover:text-sky-300 disabled:opacity-40 transition-colors"
                        title="Re-check CDRs now"
                        data-testid="btn-recheck-cdrs"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${billingQ.isFetching ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                  </div>
                  <p className={`text-2xl font-bold ${noCdr > 0 ? 'text-sky-300' : 'text-slate-400'}`} data-testid="billing-no-cdr">{noCdr}</p>
                  {noCdr > 0 && <p className="text-[10px] text-sky-500/70 mt-1">Auto-checking every 10s</p>}
                </div>
              </div>
            );
          })()}

          {/* How it works explainer */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-3 flex items-start gap-3">
            <Info className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-slate-400 space-y-0.5">
              <p><span className="text-slate-200 font-medium">How to read this:</span> For each governed cut, we compare what Sippy billed the customer (from CDR cache) vs. vendor cost (from Mera enrichment).</p>
              <p>
                <span className="text-emerald-400 font-medium">OK</span> = duration within cut window AND margin ≥ 0 &nbsp;·&nbsp;
                <span className="text-rose-400 font-medium">Loss</span> = vendor cost exceeds customer revenue (negative margin) — investigate routing or rates &nbsp;·&nbsp;
                <span className="text-amber-400 font-medium">Check</span> = customer billed significantly more seconds than cut window — review in Sippy &nbsp;·&nbsp;
                <span className="text-slate-400 font-medium">No CDR</span> = CDR not in cache yet (may appear within 5 min)
              </p>
            </div>
          </div>

          {/* Table */}
          {billingQ.isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
          ) : !billingQ.data || billingQ.data.length === 0 ? (
            <EmptyState icon={BarChart2} title="No governed cuts yet" desc="Once calls are cut by governance rules, billing comparisons will appear here." />
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-emerald-400" /> Billing Reconciliation (last 7 days)
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{billingQ.data.length} cuts · page {billingPage}/{Math.ceil(billingQ.data.length / BILLING_PAGE_SIZE)}</span>
                  {billingQ.data.some(r => r.status === 'no_cdr') && (
                    <button
                      onClick={() => retryCdrMut.mutate(undefined)}
                      disabled={retryCdrMut.isPending}
                      data-testid="billing-retry-all"
                      className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={cn('w-3 h-3', retryCdrMut.isPending && 'animate-spin')} />
                      Retry CDR ({billingQ.data.filter(r => r.status === 'no_cdr').length})
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-500">
                      <th className="px-4 py-2.5 text-left font-medium">#</th>
                      <th className="px-4 py-2.5 text-left font-medium">CLI → CLD</th>
                      <th className="px-4 py-2.5 text-left font-medium">Cut At</th>
                      <th className="px-4 py-2.5 text-right font-medium">Gov Cut</th>
                      <th className="px-4 py-2.5 text-right font-medium">Cut Window</th>
                      <th className="px-4 py-2.5 text-right font-medium">Customer Billed</th>
                      <th className="px-4 py-2.5 text-right font-medium">Cust. Cost</th>
                      <th className="px-4 py-2.5 text-right font-medium">Vendor Cost</th>
                      <th className="px-4 py-2.5 text-right font-medium">Margin</th>
                      <th className="px-4 py-2.5 text-center font-medium">Status</th>
                      <th className="px-4 py-2.5 text-center font-medium">CDR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {billingQ.data.slice((billingPage - 1) * BILLING_PAGE_SIZE, billingPage * BILLING_PAGE_SIZE).map(row => {
                      const statusCfg = {
                        ok:     { label: 'OK',      cls: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' },
                        loss:   { label: 'Loss',    cls: 'bg-rose-500/10   text-rose-300   border border-rose-500/20'   },
                        check:  { label: 'Check',   cls: 'bg-amber-500/10  text-amber-300  border border-amber-500/20'  },
                        no_cdr: { label: 'No CDR',  cls: 'bg-slate-800     text-slate-400  border border-slate-700'     },
                      }[row.status];
                      return (
                        <tr key={row.id} className="hover:bg-slate-800/20" data-testid={`billing-row-${row.id}`}>
                          <td className="px-4 py-3 text-slate-500 text-xs font-mono">#{row.id}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-slate-200 font-mono text-xs">{(row as any).displayCli ?? row.caller ?? '—'}</span>
                              <span className="text-slate-500 font-mono text-xs">→ {(row as any).displayCld ?? row.callee ?? '—'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                            {row.byeSentAt ? new Date(row.byeSentAt).toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-slate-300 font-mono">
                            {row.govSec != null ? `${row.govSec}s` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-slate-300 font-mono">
                            {row.estimatedBilledSec != null ? `${row.estimatedBilledSec}s` : '—'}
                            <span className="text-slate-600 ml-1 text-[10px]">(cut+8s)</span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {row.customerBilledSec != null ? (
                              <span className={cn(
                                row.status === 'ok'    ? 'text-emerald-300' :
                                row.status === 'check' ? 'text-amber-300'   : 'text-slate-400'
                              )}>
                                {row.customerBilledSec}s
                              </span>
                            ) : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-slate-400 font-mono">
                            {row.customerCost != null ? `$${row.customerCost.toFixed(4)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-mono text-slate-400">
                            {row.vendorCost != null ? `$${row.vendorCost.toFixed(4)}` : <span className="text-slate-700">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-mono">
                            {row.marginAmount != null ? (
                              <span className={row.marginAmount >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {row.marginAmount >= 0 ? '+' : ''}{row.marginAmount.toFixed(4)}
                              </span>
                            ) : <span className="text-slate-700">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn('px-2 py-0.5 rounded text-xs font-medium', statusCfg.cls)}
                              data-testid={`billing-status-${row.id}`}>
                              {statusCfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {row.status === 'no_cdr' ? (
                              <button
                                onClick={() => retryCdrMut.mutate(row.id)}
                                disabled={retryCdrMut.isPending}
                                title={row.cdrCheckedAt ? `Last tried: ${new Date(row.cdrCheckedAt).toLocaleString()}` : 'Retry CDR lookup'}
                                data-testid={`billing-retry-${row.id}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-amber-500/10 text-slate-500 hover:text-amber-400 border border-slate-700 hover:border-amber-500/30 transition-colors disabled:opacity-40"
                              >
                                <RefreshCw className="w-2.5 h-2.5" /> Retry
                              </button>
                            ) : row.cdrSource === 'db' ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span
                                  title={row.cdrCheckedAt ? `Stored ${new Date(row.cdrCheckedAt).toLocaleString()}` : 'From DB'}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                >
                                  DB
                                </span>
                                {row.vendorCallId ? (
                                  <span
                                    title={`SIP Call-ID: ${row.vendorCallId}`}
                                    className="px-1 py-px rounded text-[9px] bg-sky-500/10 text-sky-400 border border-sky-500/20 cursor-help"
                                  >
                                    T1·ID
                                  </span>
                                ) : row.vendorIp ? (
                                  <span
                                    title={`Matched via vendor IP: ${row.vendorIp}`}
                                    className="px-1 py-px rounded text-[9px] bg-violet-500/10 text-violet-400 border border-violet-500/20 cursor-help"
                                  >
                                    T2·IP
                                  </span>
                                ) : (
                                  <span
                                    title="Matched by CLD suffix (fallback)"
                                    className="px-1 py-px rounded text-[9px] bg-slate-500/10 text-slate-500 border border-slate-700 cursor-help"
                                  >
                                    T3·CLD
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-600">live</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Pagination controls */}
              {billingQ.data.length > BILLING_PAGE_SIZE && (() => {
                const totalPages = Math.ceil(billingQ.data.length / BILLING_PAGE_SIZE);
                const startRow   = (billingPage - 1) * BILLING_PAGE_SIZE + 1;
                const endRow     = Math.min(billingPage * BILLING_PAGE_SIZE, billingQ.data.length);
                return (
                  <div className="px-4 py-2.5 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      Showing {startRow}–{endRow} of {billingQ.data.length} cuts
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setBillingPage(p => Math.max(1, p - 1))}
                        disabled={billingPage <= 1}
                        data-testid="billing-prev-page"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-3 h-3" /> Prev
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                        <button
                          key={p}
                          onClick={() => setBillingPage(p)}
                          data-testid={`billing-page-${p}`}
                          className={cn(
                            'px-2.5 py-1 rounded text-xs border transition-colors',
                            p === billingPage
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border-slate-700',
                          )}
                        >
                          {p}
                        </button>
                      ))}
                      <button
                        onClick={() => setBillingPage(p => Math.min(totalPages, p + 1))}
                        disabled={billingPage >= totalPages}
                        data-testid="billing-next-page"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Next <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })()}
              {/* Footer note */}
              <div className="px-4 py-2.5 border-t border-slate-800 flex items-center gap-2 text-xs text-slate-600">
                <Info className="w-3 h-3 flex-shrink-0" />
                CDR match tiers: <span className="text-sky-600">T1·ID</span> = SIP Call-ID (exact, most reliable) · <span className="text-violet-600">T2·IP</span> = vendor IP + time window · <span className="text-slate-500">T3·CLD</span> = destination suffix fallback. <span className="text-emerald-700">DB</span> = resolved 45s after cut. Use Retry for unmatched cuts.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Audit Log ────────────────────────────────────────────────── */}
      {tab === 'log' && (
        <div className="space-y-4">
          {logQ.isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
          ) : logData.length === 0 ? (
            <EmptyState icon={ScrollText} title="No audit events yet" desc="All governance actions (bridge detected, vendor cut, playback started) are logged here." />
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200">Governance Audit Log</span>
                <span className="text-xs text-slate-500">{logData.length} event{logData.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-slate-800/60">
                {logData.map(entry => {
                  const Icon = EVENT_ICONS[entry.eventType] ?? Activity;
                  const isError = entry.eventType === 'error';
                  const isCut   = entry.eventType === 'vendor_bye';
                  return (
                    <div key={entry.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-800/20" data-testid={`log-entry-${entry.id}`}>
                      <div className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                        isError ? "bg-rose-500/10"   :
                        isCut   ? "bg-amber-500/10"  :
                                  "bg-slate-800"
                      )}>
                        <Icon className={cn(
                          "w-3.5 h-3.5",
                          isError ? "text-rose-400"   :
                          isCut   ? "text-amber-400"  :
                                    "text-slate-400"
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn(
                            "text-xs font-medium capitalize",
                            isError ? "text-rose-400" : isCut ? "text-amber-300" : "text-slate-200"
                          )}>
                            {entry.eventType.replace(/_/g, ' ')}
                          </span>
                          {entry.governedCallId && (
                            <span className="text-xs text-slate-500">call #{entry.governedCallId}</span>
                          )}
                          <span className="text-xs text-slate-500 ml-auto">{fmtDate(entry.createdAt)}</span>
                        </div>
                        {entry.channel && (
                          <p className="text-xs text-slate-500 font-mono truncate">{entry.channel}</p>
                        )}
                        {entry.details && (
                          <p className="text-xs text-slate-400 mt-0.5">{entry.details}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Prefix Registry tab ─────────────────────────────────────────── */}
      {tab === 'prefixes' && (
        <div className="space-y-4">
          {/* Sub-nav + actions */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
              {(['vendors','audit'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setPrefixView(v)}
                  data-testid={`prefix-view-${v}`}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                    prefixView === v
                      ? "bg-violet-600 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  {v === 'vendors' ? 'Vendors' : 'Audit Log'}
                </button>
              ))}
            </div>
            {prefixView === 'vendors' && (
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search vendor or prefix…"
                  value={prefixSearch}
                  onChange={e => setPrefixSearch(e.target.value)}
                  className="h-8 w-52 bg-slate-900 border-slate-700 text-xs"
                  data-testid="prefix-search"
                />
                <Button
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => setShowRegForm(v => !v)}
                  data-testid="btn-register-vendor"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />Register Vendor
                </Button>
              </div>
            )}
          </div>

          {/* Register form */}
          {showRegForm && prefixView === 'vendors' && (
            <div className="bg-slate-900/70 border border-violet-500/30 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">Register New Vendor</h3>
              <p className="text-xs text-slate-400">A unique 4-digit prefix block will be auto-generated. All four product prefixes (FC×1, BC×2, SB×6, SC×7) are created automatically.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Vendor Name *</label>
                  <Input
                    value={newVendorName}
                    onChange={e => setNewVendorName(e.target.value)}
                    placeholder="e.g. NEWCARRIER"
                    className="bg-slate-800 border-slate-700 text-sm h-8"
                    data-testid="input-vendor-name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Description (optional)</label>
                  <Input
                    value={newVendorDesc}
                    onChange={e => setNewVendorDesc(e.target.value)}
                    placeholder="e.g. Transit carrier — EU"
                    className="bg-slate-800 border-slate-700 text-sm h-8"
                    data-testid="input-vendor-desc"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={!newVendorName.trim() || registerVendorMut.isPending}
                  onClick={() => registerVendorMut.mutate({ name: newVendorName, description: newVendorDesc })}
                  data-testid="btn-confirm-register"
                >
                  {registerVendorMut.isPending ? 'Registering…' : 'Confirm Registration'}
                </Button>
                <Button size="sm" variant="ghost" className="text-slate-400" onClick={() => { setShowRegForm(false); setNewVendorName(''); setNewVendorDesc(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Vendors table */}
          {prefixView === 'vendors' && (
            vendorsQ.isLoading ? (
              <div className="space-y-2">{[...Array(6)].map((_,i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
            ) : (
              (() => {
                const allVendors = vendorsQ.data ?? [];
                const q = prefixSearch.trim().toLowerCase();
                const filtered = q
                  ? allVendors.filter(v =>
                      v.name.toLowerCase().includes(q) ||
                      v.vendorPrefix.includes(q) ||
                      v.prefixes.some(p => p.fullPrefix.includes(q))
                    )
                  : allVendors;

                const statusBg: Record<string,string> = {
                  active:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                  suspended: 'bg-amber-500/10  text-amber-400  border-amber-500/20',
                  retired:   'bg-rose-500/10   text-rose-400   border-rose-500/20',
                };
                const productLabels: Record<string,string> = { '1':'FC','2':'BC','6':'SB','7':'SC' };
                const productColors: Record<string,string>  = {
                  '1':'bg-sky-500/10 text-sky-300 border-sky-500/20',
                  '2':'bg-violet-500/10 text-violet-300 border-violet-500/20',
                  '6':'bg-teal-500/10 text-teal-300 border-teal-500/20',
                  '7':'bg-orange-500/10 text-orange-300 border-orange-500/20',
                };

                return (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-200">
                        Canonical Vendor Registry
                      </span>
                      <span className="text-xs text-slate-500">{filtered.length} of {allVendors.length} vendors</span>
                    </div>
                    {filtered.length === 0 ? (
                      <div className="py-12 text-center text-slate-500 text-sm">No vendors match your search</div>
                    ) : (
                      <div className="divide-y divide-slate-800/60">
                        {filtered.map(vendor => {
                          const isExpanded = expandedVendorId === vendor.id;
                          const prefixByCode = Object.fromEntries(vendor.prefixes.map(p => [p.productCode, p]));
                          return (
                            <div key={vendor.id} data-testid={`vendor-row-${vendor.id}`}>
                              {/* Main row */}
                              <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/20">
                                <button
                                  onClick={() => setExpandedVendorId(isExpanded ? null : vendor.id)}
                                  className="text-slate-500 hover:text-slate-300 flex-shrink-0"
                                  data-testid={`vendor-expand-${vendor.id}`}
                                >
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>

                                {/* Name + prefix */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-slate-100">{vendor.name}</span>
                                    <span className="font-mono text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">{vendor.vendorPrefix}</span>
                                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", statusBg[vendor.status] ?? statusBg.active)}>
                                      {vendor.status}
                                    </span>
                                  </div>
                                  {vendor.description && (
                                    <p className="text-xs text-slate-500 truncate mt-0.5">{vendor.description}</p>
                                  )}
                                </div>

                                {/* Product prefix badges */}
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {(['1','2','6','7'] as const).map(code => {
                                    const p = prefixByCode[code];
                                    if (!p) return null;
                                    return (
                                      <span
                                        key={code}
                                        className={cn(
                                          "font-mono text-[10px] px-1.5 py-0.5 rounded border",
                                          p.status === 'active' ? productColors[code] : 'bg-slate-800/50 text-slate-600 border-slate-700/50 line-through'
                                        )}
                                        title={`${productLabels[code]}: ${p.fullPrefix} (${p.status})`}
                                        data-testid={`prefix-badge-${p.fullPrefix}`}
                                      >
                                        {productLabels[code]}·{p.fullPrefix}
                                      </span>
                                    );
                                  })}
                                </div>

                                {/* Vendor-level actions */}
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {vendor.status === 'active' && (
                                    <>
                                      <Button
                                        size="sm" variant="ghost"
                                        className="h-7 px-2 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 text-xs"
                                        title="Suspend vendor"
                                        onClick={() => vendorStatusMut.mutate({ id: vendor.id, status: 'suspended' })}
                                        data-testid={`btn-suspend-vendor-${vendor.id}`}
                                      >
                                        <PauseCircle className="w-3.5 h-3.5 mr-1" />Suspend
                                      </Button>
                                      <Button
                                        size="sm" variant="ghost"
                                        className="h-7 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs"
                                        title="Retire vendor"
                                        onClick={() => vendorStatusMut.mutate({ id: vendor.id, status: 'retired' })}
                                        data-testid={`btn-retire-vendor-${vendor.id}`}
                                      >
                                        <Archive className="w-3.5 h-3.5 mr-1" />Retire
                                      </Button>
                                    </>
                                  )}
                                  {(vendor.status === 'suspended' || vendor.status === 'retired') && (
                                    <Button
                                      size="sm" variant="ghost"
                                      className="h-7 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 text-xs"
                                      onClick={() => vendorStatusMut.mutate({ id: vendor.id, status: 'active' })}
                                      data-testid={`btn-reactivate-vendor-${vendor.id}`}
                                    >
                                      <RotateCcw className="w-3.5 h-3.5 mr-1" />Reactivate
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {/* Expanded: per-prefix detail */}
                              {isExpanded && (
                                <div className="px-12 pb-3 pt-1 bg-slate-950/40 border-t border-slate-800/40">
                                  <div className="grid grid-cols-4 gap-2">
                                    {(['1','2','6','7'] as const).map(code => {
                                      const p = prefixByCode[code];
                                      if (!p) return null;
                                      return (
                                        <div key={code} className={cn(
                                          "rounded-lg border p-3 space-y-1.5",
                                          p.status === 'active' ? 'bg-slate-900 border-slate-800' : 'bg-slate-900/40 border-slate-800/40 opacity-60'
                                        )}>
                                          <div className="flex items-center justify-between">
                                            <span className={cn("text-[10px] font-bold uppercase", productColors[code].split(' ')[1])}>
                                              {productLabels[code]}
                                            </span>
                                            <span className={cn("text-[10px] px-1 py-0.5 rounded border", statusBg[p.status] ?? statusBg.active)}>
                                              {p.status}
                                            </span>
                                          </div>
                                          <div className="font-mono text-lg font-bold text-slate-100">{p.fullPrefix}</div>
                                          <p className="text-[10px] text-slate-500 leading-tight">{p.productName}</p>
                                          <div className="flex gap-1 pt-1">
                                            {p.status === 'active' ? (
                                              <>
                                                <button
                                                  onClick={() => prefixStatusMut.mutate({ id: p.id, status: 'suspended' })}
                                                  className="text-[10px] text-amber-400 hover:underline"
                                                  data-testid={`btn-suspend-prefix-${p.id}`}
                                                >Suspend</button>
                                                <span className="text-slate-700">·</span>
                                                <button
                                                  onClick={() => prefixStatusMut.mutate({ id: p.id, status: 'retired' })}
                                                  className="text-[10px] text-rose-400 hover:underline"
                                                  data-testid={`btn-retire-prefix-${p.id}`}
                                                >Retire</button>
                                              </>
                                            ) : (
                                              <button
                                                onClick={() => prefixStatusMut.mutate({ id: p.id, status: 'active' })}
                                                className="text-[10px] text-emerald-400 hover:underline"
                                                data-testid={`btn-activate-prefix-${p.id}`}
                                              >Reactivate</button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()
            )
          )}

          {/* Audit log view */}
          {prefixView === 'audit' && (
            prefixAuditQ.isLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_,i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
            ) : (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">Prefix Registry Audit Log</span>
                  <span className="text-xs text-slate-500">{prefixAuditQ.data?.length ?? 0} entries</span>
                </div>
                <div className="divide-y divide-slate-800/60">
                  {(prefixAuditQ.data ?? []).map(entry => {
                    const actionColor =
                      entry.action.includes('retired')   ? 'text-rose-400'    :
                      entry.action.includes('suspended') ? 'text-amber-400'   :
                      entry.action.includes('active')    ? 'text-emerald-400' :
                                                           'text-slate-300';
                    return (
                      <div key={entry.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-800/20" data-testid={`prefix-audit-${entry.id}`}>
                        <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Hash className="w-3.5 h-3.5 text-violet-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("text-xs font-medium", actionColor)}>
                              {entry.action.replace(/_/g, ' ')}
                            </span>
                            {entry.vendorName && <span className="text-xs text-slate-400">{entry.vendorName}</span>}
                            {entry.fullPrefix  && <span className="font-mono text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">{entry.fullPrefix}</span>}
                            {entry.performedBy && <span className="text-xs text-slate-600">by {entry.performedBy}</span>}
                            <span className="text-xs text-slate-500 ml-auto">{fmtDate(entry.createdAt)}</span>
                          </div>
                          {entry.details && (
                            <p className="text-xs text-slate-500 mt-0.5 font-mono truncate">
                              {typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
