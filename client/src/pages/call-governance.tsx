import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Phone, Scissors, Clock, RefreshCw, Plus, Pencil, Trash2,
  CheckCircle2, XCircle, AlertTriangle, Wifi, WifiOff, FileAudio,
  Activity, Copy, ChevronLeft, ChevronRight, Settings2, ScrollText, Zap, Info,
  Play, Pause, Volume2, Download, X, BarChart2, TrendingDown, Hash,
  PauseCircle, Archive, RotateCcw, ChevronDown, ChevronUp,
  TrendingUp, Globe2, Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from "recharts";
import { resolveDestination, searchCountries, type CountryEntry } from "@/lib/e164-countries";

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

// ── Analytics types ────────────────────────────────────────────────────────────

interface AnalyticsKpi {
  total_calls: string | number;
  calls_governed: string | number;
  calls_passed: string | number;
  governance_minutes: string | number;
  vendor_minutes: string | number;
  cdr_resolved: string | number;
  /** cap_sec − actual_cut_sec for every governed call / 60 — minutes of vendor billing prevented */
  saved_minutes: string | number;
  /** sum of cap_sec for all cut calls / 60 — denominator for Governance Efficiency % */
  potential_minutes: string | number;
}

interface AnalyticsRuleRow {
  rule_id: number | null;
  rule_name: string | null;
  connection_name: string | null;
  destination_prefix: string | null;
  cap_sec: number | null;
  calls_matched: string | number;
  calls_cut: string | number;
  calls_passed: string | number;
  gov_minutes: string | number;
  avg_cut_sec: string | number;
  vendor_minutes: string | number;
  last_triggered: string | null;
}

interface AnalyticsTrendBucket {
  bucket: string;
  calls: string | number;
  governed: string | number;
  gov_minutes: string | number;
}

interface AnalyticsCallRow {
  callee: string | null;
  bye_sent_at: string | null;
  start_time: string | null;
  cdr_duration: number | null;
  cap_sec: number | null;
  status: string;
  rule_id: number | null;
}

interface AnalyticsData {
  period: string;
  periodStart: string;
  kpi: AnalyticsKpi;
  rules: AnalyticsRuleRow[];
  trend: AnalyticsTrendBucket[];
  calls: AnalyticsCallRow[];
}

// ── Live Monitor types ─────────────────────────────────────────────────────────

interface LiveActiveCall {
  id: number;
  callee: string | null;
  caller: string | null;
  start_time: string | null;
  cap_sec: number | null;
  channel_b: string | null;
  rule_name: string | null;
  connection_name: string | null;
  elapsed_sec: number;
}
interface LiveMonitorRecent {
  cuts_5min: string | number;
  cuts_15min: string | number;
  cuts_30min: string | number;
  gov_min_30min: string | number;
  gov_min_5min: string | number;
}
interface LiveMonitorKpi {
  total_today: string | number;
  cut_today: string | number;
  passed_today: string | number;
  gov_min_today: string | number;
  avg_cut_sec_today: string | number;
  total_1h: string | number;
  cut_1h: string | number;
}
interface LiveMonitorHour { hour: number; cuts: number; gov_min: number; }
interface LiveMonitorCallRow {
  callee: string | null;
  rule_id: number | null;
  is_cut: boolean;
  gov_sec: number | null;
}
interface LiveMonitorData {
  activeNow: LiveActiveCall[];
  recent: LiveMonitorRecent;
  todayKpi: LiveMonitorKpi;
  hourly: LiveMonitorHour[];
  calls: LiveMonitorCallRow[];
  fetchedAt: string;
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
  const [countrySearch, setCountrySearch] = useState("");
  const [showPicker, setShowPicker]       = useState(false);

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
            onChange={e => { set('destinationPrefix', e.target.value); setCountrySearch(""); }}
            placeholder="e.g. 92 (Pakistan), 971 (UAE)"
            className="bg-slate-900/50 border-slate-700"
          />
          {/* Resolved country name badge */}
          {(() => {
            const m = form.destinationPrefix ? resolveDestination(form.destinationPrefix) : null;
            return m ? (
              <p className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                <span>{m.flag}</span> {m.name}
              </p>
            ) : form.destinationPrefix ? (
              <p className="text-xs text-amber-400">Unknown prefix — type country name below to search</p>
            ) : null;
          })()}
          {/* Country picker combobox */}
          <div className="relative">
            <Input
              data-testid="input-country-search"
              value={countrySearch}
              onChange={e => setCountrySearch(e.target.value)}
              onFocus={() => setShowPicker(true)}
              onBlur={() => setTimeout(() => setShowPicker(false), 160)}
              placeholder="🔍 Search country name to auto-fill prefix…"
              className="bg-slate-900/50 border-slate-700/50 text-xs h-7 placeholder:text-slate-600"
            />
            {showPicker && (countrySearch || !form.destinationPrefix) && (
              <div className="absolute z-50 top-8 left-0 right-0 bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-h-52 overflow-y-auto">
                {searchCountries(countrySearch, 14).map(c => (
                  <button
                    key={c.prefix}
                    type="button"
                    onMouseDown={() => {
                      set('destinationPrefix', c.prefix);
                      setCountrySearch("");
                      setShowPicker(false);
                    }}
                    data-testid={`country-option-${c.prefix}`}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-800 flex items-center gap-2"
                  >
                    <span className="text-base leading-none">{c.flag}</span>
                    <span className="text-slate-200">{c.name}</span>
                    <code className="ml-auto text-amber-300 font-mono text-[11px]">+{c.prefix}</code>
                  </button>
                ))}
                {searchCountries(countrySearch, 14).length === 0 && (
                  <p className="px-3 py-2 text-xs text-slate-500">No country matches "{countrySearch}"</p>
                )}
              </div>
            )}
          </div>
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
  { id: 'analytics', label: 'Analytics',       icon: TrendingUp },
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

  const [analyticsPeriod, setAnalyticsPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const analyticsQ = useQuery<AnalyticsData>({
    queryKey: ['/api/call-governance/analytics', analyticsPeriod],
    queryFn: () => fetch(`/api/call-governance/analytics?period=${analyticsPeriod}`, { credentials: 'include' }).then(r => r.json()),
    enabled: tab === 'analytics',
    refetchInterval: tab === 'analytics' ? 60_000 : false,
    staleTime: 30_000,
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

  // Live Monitor — auto-refreshes every 15s while on the live tab
  const [liveRefreshCountdown, setLiveRefreshCountdown] = useState(15);
  const liveMonitorQ = useQuery<LiveMonitorData>({
    queryKey: ['/api/call-governance/live-monitor'],
    enabled: tab === 'live',
    refetchInterval: tab === 'live' ? 15_000 : false,
    staleTime: 10_000,
  });
  // Countdown ticker — resets to 15 on every successful fetch
  useEffect(() => {
    if (tab !== 'live') return;
    setLiveRefreshCountdown(15);
    const interval = setInterval(() => {
      setLiveRefreshCountdown(c => (c <= 1 ? 15 : c - 1));
    }, 1_000);
    return () => clearInterval(interval);
  }, [tab, liveMonitorQ.dataUpdatedAt]);

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

          {/* ── Live Governance Monitor ───────────────────────────────────── */}
          {(() => {
            const lm = liveMonitorQ.data;
            const n  = (v: string | number | undefined) => Number(v ?? 0);

            const todayKpi  = lm?.todayKpi   ?? {} as LiveMonitorKpi;
            const recent    = lm?.recent      ?? {} as LiveMonitorRecent;
            const activeNow = lm?.activeNow   ?? [];
            const hourly    = lm?.hourly      ?? [];
            const calls     = lm?.calls       ?? [];

            const totalToday    = n(todayKpi.total_today);
            const cutToday      = n(todayKpi.cut_today);
            const passedToday   = n(todayKpi.passed_today);
            const govMinToday   = n(todayKpi.gov_min_today);
            const avgCutSec     = n(todayKpi.avg_cut_sec_today);
            const total1h       = n(todayKpi.total_1h);
            const cut1h         = n(todayKpi.cut_1h);
            const cutRateToday  = totalToday > 0 ? ((cutToday / totalToday) * 100).toFixed(1) : '0.0';
            const cutRate1h     = total1h    > 0 ? ((cut1h    / total1h)    * 100).toFixed(1) : '0.0';

            const cuts5m  = n(recent.cuts_5min);
            const cuts15m = n(recent.cuts_15min);
            const cuts30m = n(recent.cuts_30min);
            const govMin5m = n(recent.gov_min_5min);

            // Hourly chart — fill all 24 hours
            const hourMap = new Map(hourly.map(h => [h.hour, { cuts: n(h.cuts), gov_min: n(h.gov_min) }]));
            const currentHour = new Date().getHours();
            const hourData = Array.from({ length: currentHour + 1 }, (_, i) => ({
              label: `${String(i).padStart(2,'0')}:00`,
              cuts:    hourMap.get(i)?.cuts    ?? 0,
              gov_min: hourMap.get(i)?.gov_min ?? 0,
            }));

            // Today's destination breakdown via LPM
            type TodayDest = { country: CountryEntry | null; prefix: string; total: number; cut: number; govMin: number; rules: Map<string, number>; };
            const destTodayMap = new Map<string, TodayDest>();
            for (const c of calls) {
              const digits = (c.callee ?? '').replace(/\D/g, '');
              const country = resolveDestination(digits);
              const key = country?.prefix ?? (digits.slice(0, 3) || 'unknown');
              if (!destTodayMap.has(key)) destTodayMap.set(key, { country, prefix: key, total: 0, cut: 0, govMin: 0, rules: new Map() });
              const eg = destTodayMap.get(key)!;
              eg.total++;
              if (c.is_cut) { eg.cut++; eg.govMin += (n(c.gov_sec)) / 60; }
              const rn: string = (c as any).rule_name ?? 'Unknown';
              eg.rules.set(rn, (eg.rules.get(rn) ?? 0) + 1);
            }
            const destToday = [...destTodayMap.values()].sort((a, b) => b.total - a.total).slice(0, 8);
            const maxDestGovMin = destToday[0]?.govMin ?? 1;

            return (
              <>
                {/* Header bar: monitor title + last fetch + countdown */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-sm font-semibold text-slate-200">Live Governance Monitor</span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    {lm?.fetchedAt && (
                      <span className="text-[10px] text-slate-600">
                        Updated {new Date(lm.fetchedAt).toLocaleTimeString()}
                      </span>
                    )}
                    <span className={cn(
                      "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                      liveRefreshCountdown <= 3
                        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                        : "border-slate-700 text-slate-500 bg-slate-900/40"
                    )}>
                      {liveMonitorQ.isFetching ? '⟳' : `↻ ${liveRefreshCountdown}s`}
                    </span>
                    <button
                      data-testid="button-refresh-live-monitor"
                      onClick={() => liveMonitorQ.refetch()}
                      className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600"
                    >Refresh</button>
                  </div>
                </div>

                {/* Today's KPI strip */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  {[
                    { label: 'Total Today',       value: totalToday,          color: 'text-slate-200',   icon: Phone,        sub: `${total1h} last hour` },
                    { label: 'Cut Today',          value: cutToday,            color: 'text-rose-400',    icon: Scissors,     sub: `${cutRateToday}% cut rate` },
                    { label: 'Passed Today',       value: passedToday,         color: 'text-emerald-400', icon: CheckCircle2, sub: 'reached vendor' },
                    { label: 'Gov. Min Today',     value: govMinToday.toFixed(1), color: 'text-sky-400',  icon: Clock,        sub: 'vendor time capped' },
                    { label: 'Avg Cap Duration',   value: `${avgCutSec}s`,     color: 'text-amber-400',   icon: Timer,        sub: 'per cut call' },
                    { label: 'Cuts (Last 5 min)',  value: cuts5m,              color: 'text-violet-400',  icon: Zap,          sub: `${govMin5m.toFixed(1)} gov min` },
                    { label: 'Cut Rate (1h)',      value: `${cutRate1h}%`,     color: 'text-emerald-300', icon: TrendingUp,   sub: `${cut1h} of ${total1h}` },
                  ].map((k) => (
                    <div key={k.label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <k.icon className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="text-[10px] text-slate-500 font-medium leading-tight">{k.label}</span>
                      </div>
                      <div className={cn("text-lg font-bold tabular-nums", k.color)}>{k.value}</div>
                      <div className="text-[10px] text-slate-600 mt-0.5">{k.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Recent windows + Destination breakdown — side by side */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* Recent cut windows */}
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Zap className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-medium text-slate-200">Recent Governance Activity</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center mb-4">
                      {[
                        { label: 'Last 5 min',  value: cuts5m  },
                        { label: 'Last 15 min', value: cuts15m },
                        { label: 'Last 30 min', value: cuts30m },
                      ].map(w => (
                        <div key={w.label} className="bg-slate-800/40 rounded-lg p-3">
                          <div className="text-xl font-bold text-rose-400 tabular-nums">{w.value}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{w.label}</div>
                          <div className="text-[10px] text-slate-600">cuts</div>
                        </div>
                      ))}
                    </div>
                    {/* Hourly bar chart */}
                    {hourData.length > 0 && (
                      <div>
                        <div className="text-[10px] text-slate-600 mb-1">Cuts per hour — today</div>
                        <BarChart width={320} height={80} data={hourData} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 8, fill: '#475569' }} interval={Math.max(0, Math.floor(hourData.length / 5) - 1)} />
                          <YAxis tick={{ fontSize: 8, fill: '#475569' }} />
                          <Bar dataKey="cuts" fill="#7c3aed" radius={[2,2,0,0]} />
                        </BarChart>
                      </div>
                    )}
                    {hourData.length === 0 && !liveMonitorQ.isLoading && (
                      <p className="text-xs text-slate-600 text-center py-3">No cuts recorded today yet</p>
                    )}
                  </div>

                  {/* Destination breakdown today — sorted by gov minutes */}
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Globe2 className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-medium text-slate-200">Destination Activity — Today</span>
                      <span className="text-xs text-slate-600 ml-auto">{calls.length} calls</span>
                    </div>
                    {destToday.length === 0 && !liveMonitorQ.isLoading ? (
                      <p className="text-xs text-slate-500 text-center py-6">No traffic yet today</p>
                    ) : (
                      <div className="space-y-2.5">
                        {destToday.map(d => {
                          const maxGovMin = destToday[0]?.govMin ?? 1;
                          const pct = maxGovMin > 0 ? Math.round((d.govMin / maxGovMin) * 100) : 0;
                          const cutRate = d.total > 0 ? Math.round((d.cut / d.total) * 100) : 0;
                          // Primary rule = highest call count for this destination
                          const primaryRule = [...d.rules.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
                          const multiRule = d.rules.size > 1;
                          return (
                            <div key={d.prefix} data-testid={`live-dest-${d.prefix}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm leading-none w-5 flex-shrink-0">{d.country?.flag ?? '🌐'}</span>
                                <span className="text-xs font-medium text-slate-200 flex-1 truncate">
                                  {d.country?.name ?? d.prefix}
                                </span>
                                <code className="text-[10px] text-amber-300 font-mono flex-shrink-0">+{d.prefix}</code>
                                <span className="text-[10px] font-mono text-rose-400 flex-shrink-0 w-12 text-right">{d.govMin.toFixed(1)} min</span>
                              </div>
                              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-1">
                                <div className="h-full bg-violet-500/70 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-slate-600">{d.total} calls</span>
                                <span className="text-[10px] text-rose-600">{d.cut} cut ({cutRate}%)</span>
                                <span className="text-[10px] text-slate-600">{(d.total - d.cut)} passed</span>
                                <span className="ml-auto flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono truncate max-w-[140px]" title={primaryRule}>
                                  {primaryRule}{multiRule ? ` +${d.rules.size - 1}` : ''}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Active in-flight calls panel — from live-monitor endpoint */}
                {activeNow.length > 0 && (
                  <div className="bg-slate-900/60 border border-emerald-500/20 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-emerald-500/20 flex items-center gap-2 bg-emerald-500/5">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-sm font-medium text-emerald-300">In-Flight Governed Calls</span>
                      <span className="text-xs text-emerald-600 ml-auto">{activeNow.length} pending cut</span>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="bg-slate-900/40 border-b border-slate-800 text-slate-500">
                        <tr>
                          {['Callee','Connection / Rule','Elapsed','Remaining'].map(h => (
                            <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {activeNow.map(c => {
                          const remainSec = c.cap_sec != null ? Math.max(0, c.cap_sec - c.elapsed_sec) : null;
                          return (
                            <tr key={c.id} data-testid={`row-inflight-${c.id}`} className="hover:bg-slate-800/20">
                              <td className="px-4 py-2.5 font-mono text-slate-200">{c.callee ?? '?'}</td>
                              <td className="px-4 py-2.5 text-slate-400">
                                <span>{c.connection_name ?? c.rule_name ?? '—'}</span>
                              </td>
                              <td className="px-4 py-2.5 font-mono text-amber-400">{c.elapsed_sec}s</td>
                              <td className="px-4 py-2.5">
                                {remainSec != null ? (
                                  <span className={cn(
                                    "font-mono font-bold",
                                    remainSec <= 3 ? "text-rose-400 animate-pulse" :
                                    remainSec <= 10 ? "text-amber-400" : "text-sky-400"
                                  )}>{remainSec}s</span>
                                ) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            );
          })()}

          {/* ─────────────────────────────────────────────────────────────── */}
          {/* Existing: Active calls from real-time call engine (callsQ)     */}
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
                              {rule.destinationPrefix && (() => {
                                const m = resolveDestination(rule.destinationPrefix);
                                return (
                                  <span className="flex items-center gap-1">
                                    <ChevronRight className="w-3 h-3" />
                                    {m ? <span>{m.flag}</span> : null}
                                    {m
                                      ? <span className="text-amber-200">{m.name}</span>
                                      : <span className="text-slate-400">Dest</span>}
                                    <code className="text-amber-300 font-mono">{rule.destinationPrefix}*</code>
                                  </span>
                                );
                              })()}
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

          {/* Destination Coverage Panel */}
          {rules.length > 0 && (() => {
            const destRules = rules.filter(r => r.destinationPrefix);
            const catchAlls = rules.filter(r => !r.destinationPrefix && !r.callerPrefix);
            const destMap = new Map<string, { country: ReturnType<typeof resolveDestination>; rules: GovernanceRule[] }>();
            for (const r of destRules) {
              const m = resolveDestination(r.destinationPrefix!);
              const key = m?.prefix ?? r.destinationPrefix!;
              if (!destMap.has(key)) destMap.set(key, { country: m, rules: [] });
              destMap.get(key)!.rules.push(r);
            }
            const entries = [...destMap.entries()].sort((a, b) => (a[1].country?.name ?? a[0]).localeCompare(b[1].country?.name ?? b[0]));
            return (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Globe2 className="w-4 h-4 text-violet-400" />
                  <span className="text-sm font-medium text-slate-200">Destination Coverage</span>
                  <span className="text-xs text-slate-500 ml-auto">{entries.length} destination{entries.length !== 1 ? 's' : ''} · {catchAlls.length > 0 ? `${catchAlls.length} catch-all` : 'no catch-all'}</span>
                </div>
                {entries.length === 0 && catchAlls.length === 0 ? (
                  <p className="text-xs text-slate-500">No destination-specific rules configured.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {entries.map(([key, { country, rules: rs }]) => (
                      <div key={key} data-testid={`coverage-dest-${key}`} className="flex items-center gap-1.5 bg-slate-800/70 border border-slate-700/50 rounded-lg px-2.5 py-1.5">
                        {country && <span className="text-sm leading-none">{country.flag}</span>}
                        <span className="text-xs text-slate-200">{country?.name ?? key}</span>
                        <code className="text-[11px] text-amber-300 font-mono">{key}*</code>
                        <span className="text-[10px] text-slate-500">{rs.length} rule{rs.length !== 1 ? 's' : ''}</span>
                      </div>
                    ))}
                    {catchAlls.map(r => (
                      <div key={r.id} className="flex items-center gap-1.5 bg-slate-800/40 border border-slate-700/30 rounded-lg px-2.5 py-1.5">
                        <span className="text-xs text-slate-400">Catch-all:</span>
                        <span className="text-xs text-slate-300">{r.ruleName ?? r.connectionName}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

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

      {/* ── Tab: Analytics ─────────────────────────────────────────────────── */}
      {tab === 'analytics' && (() => {
        const ad = analyticsQ.data;
        const kpi = ad?.kpi ?? {} as AnalyticsKpi;

        const n = (v: string | number | undefined) => Number(v ?? 0);
        const totalCalls       = n(kpi.total_calls);
        const callsGoverned    = n(kpi.calls_governed);
        const callsPassed      = n(kpi.calls_passed);
        const govMin           = n(kpi.governance_minutes);
        const vendorMin        = n(kpi.vendor_minutes);
        const cdrResolved      = n(kpi.cdr_resolved);
        // savedMin = SUM(cap_sec − actual_cut_sec) / 60 per governed call.
        // Example: cap=120s, cut at 10s → 110s saved per call.  Comes from server.
        const savedMin         = n(kpi.saved_minutes);
        const potentialMin     = n(kpi.potential_minutes);
        // Governance Efficiency % = saved ÷ potential × 100
        // "Of the maximum vendor minutes governance was configured to allow, how much did we prevent?"
        const efficiencyPct    = potentialMin > 0 ? ((savedMin / potentialMin) * 100).toFixed(1) : '0.0';
        const impactPct        = totalCalls > 0 ? ((callsGoverned / totalCalls) * 100).toFixed(1) : '0.0';
        const cdrCovPct        = callsGoverned > 0 ? Math.round((cdrResolved / callsGoverned) * 100) : 0;

        // Client-side destination grouping via LPM
        // Also tracks per-destination: savedMin (cap−cut), mostTriggeredRuleId
        type DestGroup = {
          country: CountryEntry | null;
          prefix: string;
          totalCalls: number; govCalls: number;
          govMin: number; vendorMin: number; cdrCount: number;
          savedMin: number;
          ruleCounts: Map<number, number>;   // ruleId → count
        };
        const destMap = new Map<string, DestGroup>();
        for (const c of (ad?.calls ?? [])) {
          const digits = (c.callee ?? '').replace(/\D/g, '');
          const country = resolveDestination(digits);
          const key = country?.prefix ?? (digits.slice(0, 3) || 'unknown');
          if (!destMap.has(key)) {
            destMap.set(key, { country, prefix: country?.prefix ?? key, totalCalls: 0, govCalls: 0, govMin: 0, vendorMin: 0, cdrCount: 0, savedMin: 0, ruleCounts: new Map() });
          }
          const eg = destMap.get(key)!;
          eg.totalCalls++;
          if (c.rule_id != null) {
            eg.ruleCounts.set(c.rule_id, (eg.ruleCounts.get(c.rule_id) ?? 0) + 1);
          }
          if (c.bye_sent_at && c.start_time) {
            eg.govCalls++;
            const cutSec = (new Date(c.bye_sent_at).getTime() - new Date(c.start_time).getTime()) / 1000;
            eg.govMin += cutSec / 60;
            if (c.cap_sec != null) {
              eg.savedMin += Math.max(0, c.cap_sec - cutSec) / 60;
            }
          }
          if (c.cdr_duration != null) { eg.vendorMin += c.cdr_duration / 60; eg.cdrCount++; }
        }
        const destGroups = [...destMap.values()].sort((a, b) => b.totalCalls - a.totalCalls);

        // Top 4 named destinations + Others rollup for the highlight panel
        const topDests    = destGroups.slice(0, 4);
        const otherDests  = destGroups.slice(4);
        const othersTotal = otherDests.reduce((s, g) => s + g.totalCalls, 0);
        const maxDestCalls = destGroups[0]?.totalCalls ?? 1;

        // Top 5 rules by calls_cut for the top-rules panel
        const topRules = [...(ad?.rules ?? [])]
          .sort((a, b) => n(b.calls_cut) - n(a.calls_cut))
          .slice(0, 5);

        // Build rule name lookup (ruleId → ruleName) from per-rule data
        const ruleNameMap = new Map<number, string>();
        for (const r of (ad?.rules ?? [])) {
          if (r.rule_id != null) ruleNameMap.set(r.rule_id, r.rule_name ?? r.connection_name ?? `Rule ${r.rule_id}`);
        }

        // Trend chart data
        const trendData = (ad?.trend ?? []).map((t) => ({
          label: (() => {
            const d = new Date(t.bucket);
            return analyticsPeriod === 'daily'
              ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
          })(),
          Calls:    n(t.calls),
          Governed: n(t.governed),
          GovMin:   parseFloat(String(t.gov_minutes)),
        }));

        const KPIS = [
          { label: 'Total Calls',          value: totalCalls,              icon: Phone,        color: 'text-slate-200',   sub: analyticsPeriod },
          { label: 'Calls Governed',       value: callsGoverned,           icon: Scissors,     color: 'text-violet-400',  sub: `${impactPct}% of total` },
          { label: 'Calls Passed',         value: callsPassed,             icon: CheckCircle2, color: 'text-emerald-400', sub: 'reached vendor' },
          { label: 'Vendor Minutes (CDR)', value: vendorMin.toFixed(1),    icon: Timer,        color: 'text-amber-400',   sub: `${cdrCovPct}% CDR coverage` },
          { label: 'Saved Minutes',        value: savedMin.toFixed(1),     icon: TrendingDown, color: 'text-rose-400',    sub: `cap − cut per governed call` },
          { label: 'Gov. Efficiency',      value: `${efficiencyPct}%`,     icon: TrendingUp,   color: 'text-emerald-300', sub: `saved ÷ potential` },
        ];

        return (
          <div className="space-y-6" data-testid="analytics-tab">
            {/* Period selector + refresh */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-lg p-1">
                {(['daily', 'weekly', 'monthly'] as const).map(p => (
                  <button
                    key={p}
                    data-testid={`period-${p}`}
                    onClick={() => setAnalyticsPeriod(p)}
                    className={cn(
                      "px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize",
                      analyticsPeriod === p
                        ? "bg-violet-600 text-white"
                        : "text-slate-400 hover:text-slate-200",
                    )}
                  >{p}</button>
                ))}
              </div>
              <Button
                data-testid="button-refresh-analytics"
                variant="ghost" size="sm"
                onClick={() => analyticsQ.refetch()}
                disabled={analyticsQ.isFetching}
                className="text-slate-400 hover:text-slate-200 gap-1.5"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", analyticsQ.isFetching && "animate-spin")} />
                {analyticsQ.isFetching ? 'Loading…' : 'Refresh'}
              </Button>
            </div>

            {analyticsQ.isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
              </div>
            ) : analyticsQ.isError ? (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-400 text-sm">
                Failed to load analytics data. Check server logs.
              </div>
            ) : (
              <>
                {/* KPI strip */}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  {KPIS.map(({ label, value, icon: Icon, color, sub }) => (
                    <div key={label} data-testid={`kpi-${label.replace(/\s+/g,'-').toLowerCase()}`}
                      className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">{label}</span>
                        <Icon className={cn("w-3.5 h-3.5", color)} />
                      </div>
                      <div className={cn("text-2xl font-bold tabular-nums", color)}>{value}</div>
                      <div className="text-[10px] text-slate-600 capitalize">{sub}</div>
                    </div>
                  ))}
                </div>

                {/* CDR coverage notice */}
                {cdrCovPct < 80 && callsGoverned > 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="text-xs text-amber-300">
                      <strong>{cdrCovPct}%</strong> CDR coverage — Vendor Minutes and Saved Minutes are based on CDR-resolved calls only.
                      Unresolved calls typically appear within 5 minutes of the cut.
                    </span>
                  </div>
                )}

                {/* Governance Impact Summary */}
                <div className="bg-gradient-to-r from-violet-500/5 to-slate-900/0 border border-violet-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-violet-400" />
                    <span className="text-sm font-semibold text-slate-200">Governance Impact Summary</span>
                    <span className="text-xs text-slate-500 ml-auto capitalize">{analyticsPeriod} view</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                    <div>
                      <div className="text-xl font-bold text-violet-400 tabular-nums">{impactPct}%</div>
                      <div className="text-xs text-slate-500 mt-0.5">Impact Rate</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-amber-400 tabular-nums">{vendorMin.toFixed(1)}<span className="text-sm font-normal ml-0.5">min</span></div>
                      <div className="text-xs text-slate-500 mt-0.5">Vendor Minutes (CDR)</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-sky-400 tabular-nums">{govMin.toFixed(1)}<span className="text-sm font-normal ml-0.5">min</span></div>
                      <div className="text-xs text-slate-500 mt-0.5">Governance Minutes</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-rose-400 tabular-nums">{savedMin.toFixed(1)}<span className="text-sm font-normal ml-0.5">min</span></div>
                      <div className="text-xs text-slate-500 mt-0.5">Saved Minutes</div>
                      <div className="text-[10px] text-slate-600 mt-0.5">cap − cut per call</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-emerald-400 tabular-nums">{efficiencyPct}%</div>
                      <div className="text-xs text-slate-500 mt-0.5">Gov. Efficiency</div>
                      <div className="text-[10px] text-slate-600 mt-0.5">saved ÷ potential</div>
                    </div>
                  </div>
                </div>

                {/* Top Governed Destinations + Top Triggered Rules — side by side */}
                {(destGroups.length > 0 || topRules.length > 0) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                    {/* Top Governed Destinations */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Globe2 className="w-4 h-4 text-violet-400" />
                        <span className="text-sm font-medium text-slate-200">Top Governed Destinations</span>
                      </div>
                      <div className="space-y-2.5">
                        {topDests.map(g => {
                          const pct = Math.round((g.totalCalls / maxDestCalls) * 100);
                          const mostRuleId = g.ruleCounts.size > 0
                            ? [...g.ruleCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
                            : null;
                          const mostRuleName = mostRuleId != null ? (ruleNameMap.get(mostRuleId) ?? `Rule ${mostRuleId}`) : null;
                          return (
                            <div key={g.prefix} data-testid={`top-dest-${g.prefix}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-base leading-none w-5 flex-shrink-0">{g.country?.flag ?? '🌐'}</span>
                                <span className="text-xs font-medium text-slate-200 min-w-0 truncate flex-1">
                                  {g.country?.name ?? g.prefix}
                                </span>
                                <code className="text-[10px] text-amber-300 font-mono flex-shrink-0">+{g.prefix}</code>
                                <span className="text-xs font-mono text-slate-300 flex-shrink-0 w-8 text-right">{g.totalCalls}</span>
                              </div>
                              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-violet-500/70 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-600">
                                <span>{g.govCalls} cut</span>
                                <span>{g.govMin.toFixed(1)} gov min</span>
                                <span>{g.savedMin.toFixed(1)} saved min</span>
                                {mostRuleName && <span className="ml-auto truncate max-w-[100px]" title={mostRuleName}>→ {mostRuleName}</span>}
                              </div>
                            </div>
                          );
                        })}
                        {othersTotal > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-base leading-none w-5 flex-shrink-0">🌐</span>
                              <span className="text-xs font-medium text-slate-400 flex-1">Others</span>
                              <span className="text-xs font-mono text-slate-400 w-8 text-right">{othersTotal}</span>
                            </div>
                            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-slate-600/50 rounded-full" style={{ width: `${Math.round((othersTotal / maxDestCalls) * 100)}%` }} />
                            </div>
                            <div className="text-[10px] text-slate-600 mt-1">{otherDests.length} more destinations</div>
                          </div>
                        )}
                        {destGroups.length === 0 && (
                          <p className="text-xs text-slate-500 text-center py-4">No data for this period</p>
                        )}
                      </div>
                    </div>

                    {/* Top Triggered Rules */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Settings2 className="w-4 h-4 text-violet-400" />
                        <span className="text-sm font-medium text-slate-200">Top Triggered Rules</span>
                      </div>
                      {topRules.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-4">No data for this period</p>
                      ) : (
                        <div className="space-y-3">
                          {topRules.map((r, i) => {
                            const dest = r.destination_prefix ? resolveDestination(r.destination_prefix) : null;
                            const maxCut = n(topRules[0]?.calls_cut ?? 1);
                            const pct = maxCut > 0 ? Math.round((n(r.calls_cut) / maxCut) * 100) : 0;
                            return (
                              <div key={r.rule_id ?? i} data-testid={`top-rule-${r.rule_id ?? i}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] font-bold text-slate-600 w-3 flex-shrink-0">#{i + 1}</span>
                                  <span className="text-xs font-medium text-slate-200 flex-1 min-w-0 truncate">
                                    {r.rule_name ?? r.connection_name ?? `Rule ${r.rule_id}`}
                                  </span>
                                  <span className="text-xs font-mono text-rose-400 flex-shrink-0">{n(r.calls_cut)} cuts</span>
                                </div>
                                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-rose-500/60 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-600">
                                  {dest && <span>{dest.flag} {dest.name}</span>}
                                  <span>{n(r.gov_minutes).toFixed(1)} gov min</span>
                                  <span className="text-amber-600">{n(r.vendor_minutes).toFixed(1)} vendor min</span>
                                  <span className="ml-auto">{r.last_triggered ? fmtDate(r.last_triggered) : '—'}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Trend chart */}
                {trendData.length > 0 && (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <BarChart2 className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-medium text-slate-200">
                        {analyticsPeriod === 'daily' ? 'Hourly' : analyticsPeriod === 'weekly' ? 'Daily (7d)' : 'Daily (30d)'} Governance Activity
                      </span>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={trendData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={32} />
                        <RechartsTooltip
                          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: '#94a3b8' }}
                          itemStyle={{ color: '#e2e8f0' }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, color: '#64748b', paddingTop: 8 }} />
                        <Bar dataKey="Calls"    fill="#6d28d9" radius={[2,2,0,0]} name="Total Calls" />
                        <Bar dataKey="Governed" fill="#a855f7" radius={[2,2,0,0]} name="Governed" />
                      </BarChart>
                    </ResponsiveContainer>
                    {trendData.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs text-slate-500 mb-2">Governance Minutes / bucket</div>
                        <ResponsiveContainer width="100%" height={100}>
                          <AreaChart data={trendData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                            <defs>
                              <linearGradient id="govMinGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#38bdf8" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={32} />
                            <RechartsTooltip
                              contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
                              labelStyle={{ color: '#94a3b8' }}
                              itemStyle={{ color: '#e2e8f0' }}
                            />
                            <Area dataKey="GovMin" stroke="#38bdf8" fill="url(#govMinGrad)" strokeWidth={2} name="Gov. Minutes" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}

                {/* Rule Performance table */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-medium text-slate-200">Rule Performance</span>
                    </div>
                    <span className="text-xs text-slate-500">{(ad?.rules ?? []).length} rule{(ad?.rules ?? []).length !== 1 ? 's' : ''}</span>
                  </div>
                  {(ad?.rules ?? []).length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">No governed calls in this period.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" data-testid="table-rule-performance">
                        <thead className="bg-slate-900/40 border-b border-slate-800 text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-medium">Rule</th>
                            <th className="px-4 py-2.5 text-left font-medium">Destination</th>
                            <th className="px-3 py-2.5 text-right font-medium">Matched</th>
                            <th className="px-3 py-2.5 text-right font-medium">Cut</th>
                            <th className="px-3 py-2.5 text-right font-medium">Passed</th>
                            <th className="px-3 py-2.5 text-right font-medium">Avg Cut (s)</th>
                            <th className="px-3 py-2.5 text-right font-medium">Gov. Min</th>
                            <th className="px-3 py-2.5 text-right font-medium">Vendor Min</th>
                            <th className="px-3 py-2.5 text-right font-medium">Last Triggered</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {(ad?.rules ?? []).map((r, i) => {
                            const dest = r.destination_prefix ? resolveDestination(r.destination_prefix) : null;
                            return (
                              <tr key={r.rule_id ?? i} data-testid={`row-rule-${r.rule_id ?? i}`} className="hover:bg-slate-800/30">
                                <td className="px-4 py-2.5">
                                  <div className="font-medium text-slate-200 truncate max-w-[150px]">{r.rule_name ?? r.connection_name ?? '—'}</div>
                                  {r.rule_name && <div className="text-slate-600 truncate">{r.connection_name}</div>}
                                </td>
                                <td className="px-4 py-2.5">
                                  {dest ? (
                                    <span className="flex items-center gap-1">
                                      <span>{dest.flag}</span>
                                      <span className="text-slate-300">{dest.name}</span>
                                      <code className="text-amber-300 font-mono text-[10px]">{r.destination_prefix}*</code>
                                    </span>
                                  ) : r.destination_prefix ? (
                                    <code className="text-amber-300 font-mono">{r.destination_prefix}*</code>
                                  ) : (
                                    <span className="text-slate-600">All destinations</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-slate-200">{n(r.calls_matched)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-rose-400">{n(r.calls_cut)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-emerald-400">{n(r.calls_passed)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-sky-300">{n(r.avg_cut_sec).toFixed(0)}s</td>
                                <td className="px-3 py-2.5 text-right font-mono text-sky-400">{n(r.gov_minutes).toFixed(1)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-amber-400">{n(r.vendor_minutes).toFixed(1)}</td>
                                <td className="px-3 py-2.5 text-right text-slate-500">{r.last_triggered ? fmtDate(r.last_triggered) : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Destination Impact table */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe2 className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-medium text-slate-200">Destination Impact Analysis</span>
                    </div>
                    <span className="text-xs text-slate-500">{destGroups.length} destination{destGroups.length !== 1 ? 's' : ''}</span>
                  </div>
                  {destGroups.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">No governed calls in this period.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" data-testid="table-destination-impact">
                        <thead className="bg-slate-900/40 border-b border-slate-800 text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-medium">Destination</th>
                            <th className="px-3 py-2.5 text-right font-medium">Total Calls</th>
                            <th className="px-3 py-2.5 text-right font-medium">Cut</th>
                            <th className="px-3 py-2.5 text-right font-medium">Vendor Min</th>
                            <th className="px-3 py-2.5 text-right font-medium">Gov. Min</th>
                            <th className="px-3 py-2.5 text-right font-medium">Saved Min</th>
                            <th className="px-3 py-2.5 text-right font-medium">Avg Cut</th>
                            <th className="px-4 py-2.5 text-left font-medium">Most Triggered Rule</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {destGroups.map((g) => {
                            const avgCutSec = g.govCalls > 0 ? Math.round((g.govMin * 60) / g.govCalls) : 0;
                            const mostRuleId = g.ruleCounts.size > 0
                              ? [...g.ruleCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
                              : null;
                            const mostRuleName = mostRuleId != null
                              ? (ruleNameMap.get(mostRuleId) ?? `Rule ${mostRuleId}`)
                              : null;
                            const mostRuleCount = mostRuleId != null ? g.ruleCounts.get(mostRuleId) ?? 0 : 0;
                            return (
                              <tr key={g.prefix} data-testid={`row-dest-${g.prefix}`} className="hover:bg-slate-800/30">
                                <td className="px-4 py-2.5">
                                  <span className="flex items-center gap-1.5">
                                    {g.country && <span className="text-sm leading-none">{g.country.flag}</span>}
                                    <span className="text-slate-200">{g.country?.name ?? g.prefix}</span>
                                    <code className="text-amber-300 font-mono text-[10px]">+{g.prefix}</code>
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-slate-200">{g.totalCalls}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-violet-400">{g.govCalls}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-amber-400">{g.vendorMin.toFixed(1)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-sky-400">{g.govMin.toFixed(1)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-rose-400">{g.savedMin.toFixed(1)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-slate-400">
                                  {avgCutSec > 0 ? `${avgCutSec}s` : '—'}
                                </td>
                                <td className="px-4 py-2.5">
                                  {mostRuleName ? (
                                    <span className="flex items-center gap-1.5">
                                      <span className="text-slate-300 truncate max-w-[160px]" title={mostRuleName}>{mostRuleName}</span>
                                      <span className="text-[10px] text-slate-600 flex-shrink-0">×{mostRuleCount}</span>
                                    </span>
                                  ) : (
                                    <span className="text-slate-600">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Empty state */}
                {totalCalls === 0 && !analyticsQ.isLoading && (
                  <EmptyState
                    icon={TrendingUp}
                    title="No governed calls in this period"
                    desc="Analytics will populate here once calls are processed through the governance engine. Switch period or check back after traffic flows through."
                  />
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
