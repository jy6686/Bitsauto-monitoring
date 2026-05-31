import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Clock, BarChart3, Send, Wallet, Activity, ChevronDown, ChevronRight, Loader2,
  WifiOff, Info, Plus, Trash2, Phone, PhoneOff, Settings2, Eye, EyeOff,
  FlipHorizontal, CheckCheck, Plug, Copy, Check, Zap, PhoneCall, Pin, PinOff,
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
import { useNocWebSocket } from "@/hooks/use-noc-ws";

// ── WhatsApp icon (simple SVG) ─────────────────────────────────────────────
function WaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// ── RetryCountdown ─────────────────────────────────────────────────────────
function RetryCountdown({ nextRetryAt, msgId }: { nextRetryAt: string; msgId: number }) {
  const getState = () => {
    const ms = new Date(nextRetryAt).getTime() - Date.now();
    if (ms <= 0) return { label: "Retry pending…", imminent: false, pending: true };
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const label = m > 0 ? `Next retry in ${m}m ${s.toString().padStart(2, "0")}s` : `Next retry in ${s}s`;
    return { label, imminent: totalSec < 30, pending: false };
  };

  const [state, setState] = useState(getState);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setState(getState());
    timerRef.current = setInterval(() => {
      setState(getState());
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [nextRetryAt]);

  return (
    <span
      className={cn(
        "transition-colors duration-300",
        state.pending
          ? "text-orange-400/70"
          : state.imminent
          ? "text-orange-400 animate-pulse"
          : "text-orange-400/70"
      )}
      data-testid={`next-retry-${msgId}`}
    >
      {state.label}
    </span>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

interface Stats {
  sentToday:       number;
  deliveredToday:  number;
  failedToday:     number;
  pendingToday:    number;
  deliveryRate:    number;
  balance:         number;
  currency:        string;
  balanceError?:   string;
  operatorBreakdown:  { operator: string; sent: number; delivered: number; rate: number }[];
  channelBreakdown:   { channel: string; sent: number; delivered: number; failed: number; rate: number }[];
}

interface VoiceOtpStats {
  callsToday:   number;
  successToday: number;
  failedToday:  number;
  pendingToday: number;
}

interface VoiceOtpHourlyPoint {
  hour:    string;
  total:   number;
  success: number;
  rate:    number;
}

/** Calls ringing for longer than this many seconds are flagged with a warning */
const RINGING_TOO_LONG_THRESHOLD_SEC = 30;

interface SmsMessage {
  id:                 number;
  internalId?:        string;
  bhaooId?:           string;
  toNumber:           string;
  fromId?:            string;
  messageText?:       string;
  status:             string;
  operator?:          string;
  country?:           string;
  errorMessage?:      string;
  fallbackTriggered?: boolean;
  fallbackAt?:        string;
  fallbackFrom?:      number;
  submittedAt:        string;
  dlrReceivedAt?:     string;
  channel?:           string;
  provider?:          string;
  latencyMs?:         number;
  messageType?:       string;
  retryCount?:        number;
  nextRetryAt?:       string;
}

interface BhaooStatus {
  connected:      boolean;
  balance?:       number;
  currency?:      string;
  error?:         string;
  balanceUnknown?: boolean;
}

interface BhaooProfile {
  id:        number;
  name:      string;
  baseUrl:   string;
  apiKey:    string;
  secretKey: string;
  isDefault: boolean;
  isActive:  boolean;
  createdAt: string;
}

interface OtpPolicy {
  primary:               string;
  fallback:              string[];
  whatsappMaxRetries?:   number;
  whatsappRetryAfterMin?: number;
}

interface VoiceOtpCall {
  id:           number;
  toNumber:     string;
  otp:          string;
  trunk?:       string;
  asteriskId?:  string;
  status:       string;
  errorMessage?: string;
  initiatedAt:  string;
  answeredAt?:  string;
  completedAt?: string;
}

const EMPTY_PROFILE = { name: '', baseUrl: 'http://149.20.185.6/BhaooSMSV5', apiKey: '', secretKey: '', isDefault: false };

type ChannelFilter = 'all' | 'sms' | 'voice' | 'whatsapp' | 'failed' | 'fallbacks';

// ── Small helpers ──────────────────────────────────────────────────────────

function UrlCopyRow({ label, url, testId }: { label: string; url: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11px] font-mono bg-muted/60 px-2 py-1.5 rounded-lg truncate text-foreground/90 select-all">{url}</code>
        <Button size="sm" variant="outline" className="h-7 px-2 shrink-0" onClick={handleCopy} data-testid={testId}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function DlrUrlBox() {
  const origin    = window.location.origin;
  const submitUrl = `${origin}/api/bhaoo/receive`;
  const dlrUrl    = `${origin}/api/bhaoo/dlr`;
  const isDevUrl  = window.location.hostname.includes('riker.replit.dev') || window.location.hostname === 'localhost';

  return (
    <div className={`rounded-xl border p-3 space-y-3 ${isDevUrl ? 'border-amber-500/30 bg-amber-500/5' : 'border-sky-500/20 bg-sky-500/5'}`}>
      <div className="flex items-center gap-2">
        <Info className={`h-3.5 w-3.5 shrink-0 ${isDevUrl ? 'text-amber-400' : 'text-sky-400'}`} />
        <span className="text-[11px] font-medium text-foreground/80">
          REVE HTTP Profile URLs — paste both into the R.Testing1 profile
        </span>
      </div>
      <UrlCopyRow label="Submit URL (REVE → BitsAuto)" url={submitUrl} testId="button-copy-submit-url" />
      <UrlCopyRow label="DLR Callback URL (REVE → BitsAuto)" url={dlrUrl} testId="button-copy-dlr-url" />
      {isDevUrl && (
        <p className="text-[10px] text-amber-400/80">
          ⚠ Dev URL — changes on workspace restart. Use the deployed app URL in REVE production profiles.
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    delivered: { label: 'Delivered', cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    submitted: { label: 'Submitted', cls: 'text-sky-400 border-sky-500/30 bg-sky-500/10' },
    sent:      { label: 'Sent',      cls: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
    pending:   { label: 'Pending',   cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
    failed:    { label: 'Failed',    cls: 'text-rose-400 border-rose-500/30 bg-rose-500/10' },
    initiated: { label: 'Initiated', cls: 'text-violet-400 border-violet-500/30 bg-violet-500/10' },
    answered:  { label: 'Answered',  cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    unknown:   { label: 'Unknown',   cls: 'text-muted-foreground border-border' },
  };
  const s = map[status] ?? map.unknown;
  return <Badge variant="outline" className={cn("text-[10px] font-medium", s.cls)}>{s.label}</Badge>;
}

function ChannelBadge({ channel, messageType }: { channel?: string; messageType?: string }) {
  const ch = channel ?? 'sms';
  if (ch === 'whatsapp' || messageType === 'whatsapp_otp') {
    return (
      <Badge variant="outline" className="text-[10px] font-medium text-emerald-400 border-emerald-500/30 bg-emerald-500/10 gap-1">
        <WaIcon className="h-2.5 w-2.5" /> WhatsApp
      </Badge>
    );
  }
  if (ch === 'voice' || messageType === 'voice_otp') {
    return (
      <Badge variant="outline" className="text-[10px] font-medium text-violet-400 border-violet-500/30 bg-violet-500/10 gap-1">
        <Phone className="h-2.5 w-2.5" /> Voice OTP
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] font-medium text-sky-400 border-sky-500/30 bg-sky-500/10 gap-1">
      <MessageSquare className="h-2.5 w-2.5" /> SMS
    </Badge>
  );
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

function ProfileCard({
  profile, onTest, onDelete, onToggle, testingId,
}: {
  profile:   BhaooProfile;
  onTest:    (id: number) => void;
  onDelete:  (id: number) => void;
  onToggle:  (id: number, active: boolean) => void;
  testingId: number | null;
}) {
  const [showKey, setShowKey] = useState(false);
  return (
    <div className={cn(
      "rounded-xl border p-4 space-y-3",
      profile.isDefault ? "border-sky-500/40 bg-sky-500/5" : "border-border bg-card",
      !profile.isActive && "opacity-50",
    )} data-testid={`profile-card-${profile.id}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", profile.isActive ? "bg-emerald-400" : "bg-muted-foreground")} />
          <span className="text-sm font-semibold">{profile.name}</span>
          {profile.isDefault && <Badge variant="outline" className="text-[10px] text-sky-400 border-sky-500/30 bg-sky-500/10">Default</Badge>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onTest(profile.id)} disabled={testingId === profile.id} data-testid={`button-test-profile-${profile.id}`}>
            {testingId === profile.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onToggle(profile.id, !profile.isActive)} data-testid={`button-toggle-profile-${profile.id}`}>
            <FlipHorizontal className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-400 hover:text-rose-300" onClick={() => onDelete(profile.id)} data-testid={`button-delete-profile-${profile.id}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="space-y-1 text-[11px] text-muted-foreground">
        <div className="flex gap-2"><span className="w-16 shrink-0">URL</span><span className="font-mono truncate">{profile.baseUrl}</span></div>
        <div className="flex gap-2 items-center">
          <span className="w-16 shrink-0">API Key</span>
          <span className="font-mono">{showKey ? profile.apiKey : profile.apiKey.slice(0, 4) + '••••••••'}</span>
          <button onClick={() => setShowKey(v => !v)} className="ml-1 text-muted-foreground hover:text-foreground">
            {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </div>
        <div className="flex gap-2"><span className="w-16 shrink-0">Secret</span><span className="font-mono">••••••••</span></div>
      </div>
    </div>
  );
}

// ── Channel filter chips ────────────────────────────────────────────────────

const CHANNEL_FILTERS: { key: ChannelFilter; label: string; icon?: React.ReactNode }[] = [
  { key: 'all',       label: 'All' },
  { key: 'sms',       label: 'SMS',       icon: <MessageSquare className="h-3 w-3" /> },
  { key: 'voice',     label: 'Voice',     icon: <Phone className="h-3 w-3" /> },
  { key: 'whatsapp',  label: 'WhatsApp',  icon: <WaIcon className="h-3 w-3" /> },
  { key: 'failed',    label: 'Failed',    icon: <XCircle className="h-3 w-3" /> },
  { key: 'fallbacks', label: 'Fallbacks', icon: <Zap className="h-3 w-3" /> },
];

function filterMessages(msgs: SmsMessage[], filter: ChannelFilter): SmsMessage[] {
  switch (filter) {
    case 'sms':       return msgs.filter(m => !m.channel || m.channel === 'sms');
    case 'voice':     return msgs.filter(m => m.channel === 'voice' || m.messageType === 'voice_otp');
    case 'whatsapp':  return msgs.filter(m => m.channel === 'whatsapp' || m.messageType === 'whatsapp_otp');
    case 'failed':    return msgs.filter(m => m.status === 'failed');
    case 'fallbacks': return msgs.filter(m => m.fallbackTriggered || m.fallbackFrom != null);
    default:          return msgs;
  }
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SmsMonitorPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { lastVoiceOtpUpdate } = useNocWebSocket();

  const [activeTab, setActiveTab]         = useState<'monitor' | 'profiles' | 'settings'>('monitor');
  const [showSendPanel, setShowSendPanel]   = useState(false);
  const [showWaSendPanel, setShowWaSendPanel] = useState(false);
  const [sendForm, setSendForm]             = useState({ to: '', from: 'BitsAuto', text: '', type: 'text' });
  const [waSendForm, setWaSendForm]         = useState({ to: '', message: '' });
  const [newProfile, setNewProfile]         = useState(EMPTY_PROFILE);
  const [showAddForm, setShowAddForm]       = useState(false);
  const [testingId, setTestingId]           = useState<number | null>(null);
  const [channelFilter, setChannelFilter]   = useState<ChannelFilter>('all');
  const [voiceOtpOpen, setVoiceOtpOpen]     = useState(false);
  const [now, setNow]                       = useState(() => Date.now());
  const [voiceOtpPinned, setVoiceOtpPinned] = useState<boolean>(() => {
    try { return localStorage.getItem('voiceOtpRowPinned') === 'true'; } catch { return false; }
  });

  const { data: status } = useQuery<BhaooStatus>({
    queryKey: ['/api/bhaoo/status'],
    refetchInterval: 60_000,
  });

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<Stats>({
    queryKey: ['/api/bhaoo/stats'],
    refetchInterval: 30_000,
  });

  const { data: voiceStats } = useQuery<VoiceOtpStats>({
    queryKey: ['/api/voice-otp/stats'],
    refetchInterval: 30_000,
  });

  const { data: voiceHourly } = useQuery<VoiceOtpHourlyPoint[]>({
    queryKey: ['/api/voice-otp/stats/hourly'],
    refetchInterval: 30_000,
  });

  const { data: messages, isLoading: msgsLoading } = useQuery<SmsMessage[]>({
    queryKey: ['/api/bhaoo/messages'],
    refetchInterval: 15_000,
  });

  const { data: profiles, isLoading: profilesLoading } = useQuery<BhaooProfile[]>({
    queryKey: ['/api/bhaoo/profiles'],
  });

  const { data: otpPolicy, isLoading: policyLoading } = useQuery<OtpPolicy>({
    queryKey: ['/api/messaging/policy'],
  });

  const { data: voiceCalls, isLoading: voiceLoading } = useQuery<VoiceOtpCall[]>({
    queryKey: ['/api/voice-otp/calls'],
    refetchInterval: 3_000,
  });

  useEffect(() => {
    if (!lastVoiceOtpUpdate) return;
    qc.invalidateQueries({ queryKey: ['/api/voice-otp/calls'] });
    qc.invalidateQueries({ queryKey: ['/api/voice-otp/stats'] });
  }, [lastVoiceOtpUpdate, qc]);

  const hasInitiatedCalls = voiceOtpOpen && voiceCalls?.some(c => c.status === 'initiated');
  useEffect(() => {
    if (!hasInitiatedCalls) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasInitiatedCalls]);

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

  const waSendMutation = useMutation({
    mutationFn: (body: { to: string; message: string }) => apiRequest('POST', '/api/whatsapp/message', body),
    onSuccess: async (res: any) => {
      const data = await res.json?.() ?? res;
      if (data.ok) {
        toast({ title: 'WhatsApp Sent', description: `Message dispatched${data.latencyMs ? ` in ${data.latencyMs}ms` : ''}` });
        setWaSendForm({ to: '', message: '' });
        setShowWaSendPanel(false);
        qc.invalidateQueries({ queryKey: ['/api/bhaoo/messages'] });
      } else {
        toast({ title: 'WhatsApp Failed', description: data.error ?? 'Send failed', variant: 'destructive' });
      }
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const policyMutation = useMutation({
    mutationFn: (body: OtpPolicy) => apiRequest('PATCH', '/api/messaging/policy', {
      primary:               body.primary,
      fallback:              body.fallback,
      whatsappMaxRetries:    body.whatsappMaxRetries    ?? 2,
      whatsappRetryAfterMin: body.whatsappRetryAfterMin ?? 3,
    }),
    onSuccess: () => {
      toast({ title: 'Policy updated' });
      qc.invalidateQueries({ queryKey: ['/api/messaging/policy'] });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const addProfileMutation = useMutation({
    mutationFn: (body: typeof newProfile) => apiRequest('POST', '/api/bhaoo/profiles', body),
    onSuccess: () => {
      toast({ title: 'Profile added' });
      setNewProfile(EMPTY_PROFILE);
      setShowAddForm(false);
      qc.invalidateQueries({ queryKey: ['/api/bhaoo/profiles'] });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/bhaoo/profiles/${id}`),
    onSuccess: () => {
      toast({ title: 'Profile deleted' });
      qc.invalidateQueries({ queryKey: ['/api/bhaoo/profiles'] });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const toggleProfileMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest('PATCH', `/api/bhaoo/profiles/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/bhaoo/profiles'] }),
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  async function handleTestProfile(id: number) {
    setTestingId(id);
    try {
      const res = await apiRequest('POST', `/api/bhaoo/profiles/${id}/test`, {});
      const data = await res.json();
      if (data.ok) {
        toast({ title: 'Connection OK', description: `Balance: ${data.currency ?? ''} ${data.balance ?? 'N/A'}` });
      } else {
        toast({ title: 'Test Failed', description: data.error, variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: 'Test Error', description: err.message, variant: 'destructive' });
    } finally {
      setTestingId(null);
    }
  }

  const [localPolicy, setLocalPolicy] = useState<OtpPolicy | null>(null);
  const effectivePolicy = localPolicy ?? otpPolicy ?? { primary: 'voice', fallback: [] };

  const connected        = status?.connected ?? false;
  const balanceUnknown   = status?.balanceUnknown ?? false;
  const notConfigured    = status?.error?.includes('not set');

  const filteredMessages = filterMessages(messages ?? [], channelFilter);

  const channelCounts = {
    all:       (messages ?? []).length,
    sms:       (messages ?? []).filter(m => !m.channel || m.channel === 'sms').length,
    voice:     (messages ?? []).filter(m => m.channel === 'voice' || m.messageType === 'voice_otp').length,
    whatsapp:  (messages ?? []).filter(m => m.channel === 'whatsapp' || m.messageType === 'whatsapp_otp').length,
    failed:    (messages ?? []).filter(m => m.status === 'failed').length,
    fallbacks: (messages ?? []).filter(m => m.fallbackTriggered || m.fallbackFrom != null).length,
  };

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
              <h1 className="text-xl font-bold">Messaging Intelligence Center</h1>
              <p className="text-sm text-muted-foreground">SMS · Voice OTP · WhatsApp — unified channel orchestration</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border",
              notConfigured  ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
              : connected && !balanceUnknown ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : connected && balanceUnknown  ? "bg-sky-500/10 border-sky-500/30 text-sky-400"
              :                               "bg-rose-500/10 border-rose-500/30 text-rose-400"
            )}>
              {notConfigured  ? <AlertTriangle className="h-3 w-3" />
               : connected    ? <CheckCircle2 className="h-3 w-3" />
               :                <WifiOff className="h-3 w-3" />}
              {notConfigured ? 'Not configured'
               : connected && balanceUnknown ? 'Connected'
               : connected ? 'Connected'
               : 'Disconnected'}
            </div>
            <Button size="sm" variant="outline" onClick={() => { refetchStats(); qc.invalidateQueries({ queryKey: ['/api/bhaoo/status'] }); }} data-testid="button-refresh-sms">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            {/* WhatsApp send button */}
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => { setShowWaSendPanel(v => !v); setShowSendPanel(false); }}
              data-testid="button-send-whatsapp"
            >
              <WaIcon className="h-3.5 w-3.5 mr-1.5" />
              WhatsApp
              <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", showWaSendPanel && "rotate-180")} />
            </Button>
            <Button size="sm" onClick={() => { setShowSendPanel(v => !v); setShowWaSendPanel(false); }} data-testid="button-send-sms">
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

        {/* WhatsApp send panel */}
        {showWaSendPanel && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 space-y-4">
            <p className="text-sm font-semibold flex items-center gap-2">
              <WaIcon className="h-4 w-4 text-emerald-400" />
              Send WhatsApp Message
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">To (WhatsApp number with +)</Label>
                <Input placeholder="+923001112233" value={waSendForm.to} onChange={e => setWaSendForm(f => ({ ...f, to: e.target.value }))} data-testid="input-wa-to" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea placeholder="Your message here..." value={waSendForm.message} onChange={e => setWaSendForm(f => ({ ...f, message: e.target.value }))} rows={2} data-testid="textarea-wa-message" />
            </div>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
              disabled={!waSendForm.to || !waSendForm.message || waSendMutation.isPending}
              onClick={() => waSendMutation.mutate(waSendForm)}
              data-testid="button-send-whatsapp-submit"
            >
              {waSendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <WaIcon className="h-3.5 w-3.5 mr-1.5" />}
              Send
            </Button>
          </div>
        )}

        {/* SMS send panel */}
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

        {/* Tabs */}
        <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit">
          {(['monitor', 'profiles', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize",
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`tab-${tab}`}
            >
              {tab === 'monitor'  ? <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" />Monitor</span>
               : tab === 'profiles' ? <span className="flex items-center gap-1.5"><Settings2 className="h-3.5 w-3.5" />HTTP Profiles</span>
               : <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" />Channel Policy</span>}
            </button>
          ))}
        </div>

        {/* ── MONITOR TAB ── */}
        {activeTab === 'monitor' && (
          <>
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

            {/* Voice OTP stats row — shown when there are calls today, or when pinned */}
            {(voiceStats && voiceStats.callsToday > 0) || voiceOtpPinned ? (() => {
              const hasCalls = voiceStats && voiceStats.callsToday > 0;
              const successRate = hasCalls
                ? Math.round((voiceStats!.successToday / voiceStats!.callsToday) * 100)
                : 0;
              return (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-0.5">
                    <PhoneCall className="h-3.5 w-3.5 text-violet-400" />
                    <span className="font-medium text-foreground/70">Voice OTP</span>
                    <span className="text-muted-foreground/50">— today</span>
                    {!hasCalls && voiceOtpPinned && (
                      <span className="text-[10px] text-muted-foreground/60 italic ml-1">no calls yet</span>
                    )}
                    <button
                      onClick={() => {
                        const next = !voiceOtpPinned;
                        setVoiceOtpPinned(next);
                        try { localStorage.setItem('voiceOtpRowPinned', String(next)); } catch {}
                      }}
                      title={voiceOtpPinned ? 'Unpin row (hide when 0 calls)' : 'Pin row (keep visible even at 0 calls)'}
                      data-testid="button-voice-otp-pin"
                      className={cn(
                        "ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors",
                        voiceOtpPinned
                          ? "text-violet-400 hover:text-violet-300"
                          : "text-muted-foreground/50 hover:text-muted-foreground"
                      )}
                    >
                      {voiceOtpPinned
                        ? <><Pin className="h-3 w-3" /> Pinned</>
                        : <><PinOff className="h-3 w-3" /> Pin row</>}
                    </button>
                  </div>
                  {hasCalls ? (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatCard
                          label="Calls Today"
                          value={voiceStats!.callsToday.toLocaleString()}
                          color="text-violet-400"
                        />
                        <StatCard
                          label="Answered"
                          value={voiceStats!.successToday.toLocaleString()}
                          color="text-emerald-400"
                        />
                        <StatCard
                          label="Failed"
                          value={voiceStats!.failedToday.toLocaleString()}
                          color={voiceStats!.failedToday > 0 ? 'text-rose-400' : 'text-muted-foreground'}
                        />
                        <StatCard
                          label="Success Rate"
                          value={`${successRate}%`}
                          color={successRate >= 90 ? 'text-emerald-400' : successRate >= 70 ? 'text-amber-400' : 'text-rose-400'}
                        />
                      </div>

                      {/* Hourly success-rate sparkline */}
                      {voiceHourly && voiceHourly.length > 0 && (
                        <div className="bg-muted/20 border border-border/50 rounded-lg p-3 space-y-1.5" data-testid="voice-otp-hourly-chart">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">Success Rate — last 24 h (hourly)</span>
                            <span className="text-[10px] text-muted-foreground">{voiceHourly.length} hour{voiceHourly.length !== 1 ? 's' : ''} of data</span>
                          </div>
                          <ResponsiveContainer width="100%" height={56}>
                            <AreaChart data={voiceHourly} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                              <defs>
                                <linearGradient id="voiceOtpRateGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.35} />
                                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                                </linearGradient>
                              </defs>
                              <XAxis
                                dataKey="hour"
                                tickFormatter={(v: string) => {
                                  const d = new Date(v);
                                  return `${d.getHours().toString().padStart(2,'0')}h`;
                                }}
                                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                                tickLine={false}
                                axisLine={false}
                                interval="preserveStartEnd"
                              />
                              <YAxis
                                domain={[0, 100]}
                                tickFormatter={(v: number) => `${v}%`}
                                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                                tickLine={false}
                                axisLine={false}
                                ticks={[0, 50, 100]}
                              />
                              <Tooltip
                                contentStyle={{
                                  background: 'hsl(var(--card))',
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  padding: '6px 10px',
                                }}
                                labelFormatter={(v: string) => {
                                  const d = new Date(v);
                                  return `${d.getHours().toString().padStart(2,'0')}:00`;
                                }}
                                formatter={(val: number, _name: string, props: any) => {
                                  const { total, success } = props.payload;
                                  return [`${val}% (${success}/${total})`, 'Success rate'];
                                }}
                              />
                              <Area
                                type="monotone"
                                dataKey="rate"
                                stroke="#a78bfa"
                                strokeWidth={1.5}
                                fill="url(#voiceOtpRateGrad)"
                                dot={false}
                                activeDot={{ r: 3, fill: '#a78bfa', strokeWidth: 0 }}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <StatCard label="Calls Today"  value="0" color="text-muted-foreground" />
                      <StatCard label="Answered"     value="0" color="text-muted-foreground" />
                      <StatCard label="Failed"       value="0" color="text-muted-foreground" />
                      <StatCard label="Success Rate" value="—" color="text-muted-foreground" />
                    </div>
                  )}
                </div>
              );
            })() : null}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
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

              {/* Channel breakdown */}
              <div className="bg-card border border-border rounded-xl p-5 space-y-4" data-testid="channel-breakdown-card">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-sky-400" />
                  <p className="text-sm font-semibold">By Channel</p>
                  <span className="text-[10px] text-muted-foreground ml-auto">Last 24h</span>
                </div>
                {!stats || stats.channelBreakdown.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No channel data yet</p>
                ) : (
                  <div className="space-y-3">
                    {stats.channelBreakdown.map(ch => {
                      const label = ch.channel === 'sms' ? 'SMS'
                                  : ch.channel === 'voice' ? 'Voice OTP'
                                  : ch.channel === 'whatsapp' ? 'WhatsApp'
                                  : ch.channel;
                      const barColor = ch.channel === 'voice'     ? 'bg-violet-500'
                                     : ch.channel === 'whatsapp'  ? 'bg-emerald-500'
                                     : 'bg-sky-500';
                      const textColor = ch.channel === 'voice'    ? 'text-violet-400'
                                      : ch.channel === 'whatsapp' ? 'text-emerald-400'
                                      : 'text-sky-400';
                      const dotColor  = ch.channel === 'voice'    ? 'bg-violet-400'
                                      : ch.channel === 'whatsapp' ? 'bg-emerald-400'
                                      : 'bg-sky-400';
                      return (
                        <div key={ch.channel} className="space-y-1" data-testid={`channel-row-${ch.channel}`}>
                          <div className="flex justify-between text-xs items-center">
                            <span className="flex items-center gap-1.5 font-medium">
                              <span className={cn("inline-block w-1.5 h-1.5 rounded-full", dotColor)} />
                              {label}
                            </span>
                            <span className={cn("font-mono", textColor)}>{ch.rate}%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", barColor)}
                                style={{ width: `${ch.rate}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground w-20 text-right">{ch.delivered}/{ch.sent}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Message stream */}
              <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Activity className="h-4 w-4 text-sky-400" />
                  <p className="text-sm font-semibold">Message Stream</p>
                  {msgsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>

                {/* Channel filter chips */}
                <div className="flex flex-wrap gap-1.5" data-testid="channel-filter-bar">
                  {CHANNEL_FILTERS.map(f => (
                    <button
                      key={f.key}
                      onClick={() => { setChannelFilter(f.key); if (f.key === 'voice') setVoiceOtpOpen(true); }}
                      data-testid={`filter-${f.key}`}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors",
                        channelFilter === f.key
                          ? f.key === 'whatsapp'  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                            : f.key === 'voice'   ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                            : f.key === 'failed'  ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                            : f.key === 'fallbacks' ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                            : "bg-sky-500/20 border-sky-500/40 text-sky-300"
                          : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {f.icon}
                      {f.label}
                      {channelCounts[f.key] > 0 && (
                        <span className="ml-0.5 opacity-60">{channelCounts[f.key]}</span>
                      )}
                    </button>
                  ))}
                </div>

                {filteredMessages.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                    <p className="text-sm text-muted-foreground">
                      {channelFilter === 'all' ? 'No messages yet' : `No ${channelFilter} messages`}
                    </p>
                    <p className="text-xs text-muted-foreground/60">Send a test SMS or wait for incoming DLR events</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {filteredMessages.map(msg => (
                      <div key={msg.id} className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0" data-testid={`sms-message-${msg.id}`}>
                        <div className="mt-0.5 shrink-0">
                          {msg.status === 'delivered' || msg.status === 'answered'
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            : msg.status === 'failed'
                            ? <XCircle className="h-4 w-4 text-rose-400" />
                            : <Clock className="h-4 w-4 text-amber-400" />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono text-foreground/80">{msg.toNumber}</span>
                            <ChannelBadge channel={msg.channel} messageType={msg.messageType} />
                            <StatusBadge status={msg.status} />
                            {(msg.fallbackTriggered || msg.fallbackFrom != null) && (
                              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10 gap-1">
                                <Zap className="h-2.5 w-2.5" /> Fallback
                              </Badge>
                            )}
                            {(msg.retryCount != null && msg.retryCount > 0) && (
                              <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-500/30 bg-orange-500/10 gap-1" data-testid={`retry-count-${msg.id}`}>
                                <RefreshCw className="h-2.5 w-2.5" /> {msg.retryCount} {msg.retryCount === 1 ? 'retry' : 'retries'}
                              </Badge>
                            )}
                          </div>
                          {msg.messageText && (
                            <p className="text-[11px] text-muted-foreground truncate max-w-xs">{msg.messageText}</p>
                          )}
                          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                            {msg.operator && <span>{msg.operator}</span>}
                            {msg.latencyMs && <span>{msg.latencyMs}ms</span>}
                            {msg.nextRetryAt && new Date(msg.nextRetryAt).getTime() > Date.now() && (
                              <RetryCountdown nextRetryAt={msg.nextRetryAt} msgId={msg.id} />
                            )}
                          </div>
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

            {/* ── Voice OTP Stream ─────────────────────────────────────────────── */}
            <div className="bg-card border border-border rounded-xl overflow-hidden" data-testid="voice-otp-section">
              <button
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/20 transition-colors"
                onClick={() => setVoiceOtpOpen(v => !v)}
                data-testid="button-toggle-voice-otp"
              >
                <div className="p-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
                  <Phone className="h-3.5 w-3.5 text-violet-400" />
                </div>
                <span className="text-sm font-semibold text-foreground">Voice OTP</span>
                {voiceLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                {!voiceLoading && voiceCalls && voiceCalls.length > 0 && (
                  <Badge variant="outline" className="text-[10px] text-violet-400 border-violet-500/30 bg-violet-500/10 ml-1">
                    {voiceCalls.length}
                  </Badge>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {voiceOtpOpen ? 'Collapse' : 'Expand'} call stream
                </span>
                {voiceOtpOpen
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>

              {voiceOtpOpen && (
                <div className="border-t border-border px-5 pb-5 pt-4 space-y-3">
                  {voiceLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : !voiceCalls || voiceCalls.length === 0 ? (
                    <div className="text-center py-8 space-y-2">
                      <Phone className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                      <p className="text-sm text-muted-foreground">No Voice OTP calls yet</p>
                      <p className="text-xs text-muted-foreground/60">Calls initiated via the Voice OTP launcher will appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {/* Header row */}
                      <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 px-2 text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">
                        <span className="w-5" />
                        <span>Number</span>
                        <span className="w-16 text-center">OTP</span>
                        <span className="w-20 text-center">Duration</span>
                        <span className="w-24">Asterisk ID</span>
                        <span className="w-24 text-right">Time</span>
                      </div>
                      {voiceCalls.map(call => {
                        const isAnswered  = call.status === 'answered' || call.status === 'completed';
                        const isFailed    = call.status === 'failed';
                        const isInitiated = call.status === 'initiated';
                        const durationSec = call.completedAt
                          ? Math.round(
                              (new Date(call.completedAt).getTime() -
                               new Date(call.answeredAt ?? call.initiatedAt).getTime()) / 1000
                            )
                          : null;
                        const elapsedSec = isInitiated
                          ? Math.floor((now - new Date(call.initiatedAt).getTime()) / 1000)
                          : null;
                        const isRingingTooLong = isInitiated && elapsedSec !== null && elapsedSec >= RINGING_TOO_LONG_THRESHOLD_SEC;
                        return (
                          <div
                            key={call.id}
                            className={cn(
                              "grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center py-2.5 px-2 border-b border-border/40 last:border-0 rounded-lg transition-colors",
                              isRingingTooLong && "border border-orange-500/50 bg-orange-500/5 last:border last:border-orange-500/50"
                            )}
                            data-testid={`voice-call-${call.id}`}
                          >
                            {/* Status icon */}
                            <div className="w-5 shrink-0">
                              {isAnswered
                                ? <Phone className="h-4 w-4 text-emerald-400" />
                                : isFailed
                                ? <PhoneOff className="h-4 w-4 text-rose-400" />
                                : <Phone className="h-4 w-4 text-amber-400 animate-pulse" />}
                            </div>

                            {/* Number + status badges */}
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono text-foreground/80">{call.toNumber}</span>
                                <StatusBadge status={call.status} />
                                {call.trunk && (
                                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                                    {call.trunk}
                                  </Badge>
                                )}
                                {isRingingTooLong && (
                                  <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-500/40 bg-orange-500/10 gap-1" data-testid={`warning-ringing-too-long-${call.id}`}>
                                    <AlertTriangle className="h-2.5 w-2.5" /> Ringing too long
                                  </Badge>
                                )}
                              </div>
                              {call.errorMessage && (
                                <p className="text-[10px] text-rose-400/80 truncate">{call.errorMessage}</p>
                              )}
                            </div>

                            {/* OTP (masked) */}
                            <div className="w-16 text-center">
                              <span className="text-xs font-mono bg-muted/40 px-1.5 py-0.5 rounded text-foreground/70">{call.otp}</span>
                            </div>

                            {/* Duration */}
                            <div className="w-20 text-center text-xs font-mono" data-testid={`voice-call-duration-${call.id}`}>
                              {durationSec != null ? (
                                <span className="text-muted-foreground">{durationSec}s</span>
                              ) : elapsedSec != null ? (
                                <span className={cn("tabular-nums", isRingingTooLong ? "text-rose-400 font-semibold" : "text-amber-400")} data-testid={`voice-call-elapsed-${call.id}`}>{elapsedSec}s</span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </div>

                            {/* Asterisk ID */}
                            <div className="w-24">
                              {call.asteriskId
                                ? <span className="text-[10px] font-mono text-muted-foreground/70 truncate block">{call.asteriskId}</span>
                                : <span className="text-[10px] text-muted-foreground/40">—</span>}
                            </div>

                            {/* Initiated time */}
                            <div className="w-24 text-right text-[10px] text-muted-foreground/60 whitespace-nowrap">
                              {new Date(call.initiatedAt).toLocaleTimeString()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Balance alert */}
            {stats && !stats.balanceError && (stats.balance ?? 0) < 10 && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 flex items-start gap-3">
                <Wallet className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-rose-400">Low balance alert</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    Account balance is {stats.currency} {stats.balance?.toFixed(2)} — top up via BhaooSMS dashboard.
                  </p>
                </div>
              </div>
            )}

            {/* Channel policy summary banner */}
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 flex items-start gap-2">
              <Zap className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground">
                <span className="text-violet-400 font-medium">OTP Channel Policy:</span>{' '}
                {otpPolicy ? (
                  <>Primary <span className="text-foreground/80 font-medium capitalize">{otpPolicy.primary}</span>
                  {otpPolicy.fallback.length > 0 && (
                    <> → Fallback <span className="text-foreground/80 font-medium">{otpPolicy.fallback.join(', ')}</span></>
                  )}
                  . Configure in <button onClick={() => setActiveTab('settings')} className="text-violet-400 underline underline-offset-2 hover:text-violet-300">Channel Policy</button> tab.</>
                ) : 'Loading policy…'}
              </p>
            </div>

            <DlrUrlBox />
          </>
        )}

        {/* ── CHANNEL POLICY TAB ── */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div>
              <p className="text-sm font-semibold">OTP Channel Policy</p>
              <p className="text-xs text-muted-foreground mt-0.5">Control which channel delivers OTP codes when REVE sends an inbound SMS. Changes take effect immediately for all new inbound messages.</p>
            </div>

            <div className="bg-card border border-border rounded-xl p-6 space-y-6">
              {/* Primary channel */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Primary Channel</Label>
                <p className="text-xs text-muted-foreground">The first channel used to deliver an OTP code.</p>
                <div className="grid grid-cols-3 gap-3">
                  {(['voice', 'whatsapp', 'sms'] as const).map(ch => (
                    <button
                      key={ch}
                      data-testid={`policy-primary-${ch}`}
                      onClick={() => setLocalPolicy({ ...effectivePolicy, primary: ch })}
                      className={cn(
                        "flex flex-col items-center gap-2 p-4 rounded-xl border text-sm font-medium transition-colors",
                        effectivePolicy.primary === ch
                          ? ch === 'whatsapp' ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
                            : ch === 'voice'  ? "border-violet-500/60 bg-violet-500/10 text-violet-400"
                            : "border-sky-500/60 bg-sky-500/10 text-sky-400"
                          : "border-border bg-card text-muted-foreground hover:border-border/80"
                      )}
                    >
                      {ch === 'voice'    ? <Phone className="h-5 w-5" />
                       : ch === 'whatsapp' ? <WaIcon className="h-5 w-5" />
                       : <MessageSquare className="h-5 w-5" />}
                      <span className="capitalize">{ch}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Fallback channels */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Fallback Channels</Label>
                <p className="text-xs text-muted-foreground">If the primary channel fails, these channels will be tried in order. Leave empty for no fallback.</p>
                <div className="flex flex-wrap gap-2">
                  {(['voice', 'whatsapp', 'sms'] as const).filter(ch => ch !== effectivePolicy.primary).map(ch => {
                    const selected = effectivePolicy.fallback.includes(ch);
                    return (
                      <button
                        key={ch}
                        data-testid={`policy-fallback-${ch}`}
                        onClick={() => {
                          const fb = selected
                            ? effectivePolicy.fallback.filter(f => f !== ch)
                            : [...effectivePolicy.fallback, ch];
                          setLocalPolicy({ ...effectivePolicy, fallback: fb });
                        }}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors",
                          selected
                            ? ch === 'whatsapp' ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
                              : ch === 'voice'  ? "border-violet-500/60 bg-violet-500/10 text-violet-400"
                              : "border-sky-500/60 bg-sky-500/10 text-sky-400"
                            : "border-border bg-card text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {ch === 'voice'    ? <Phone className="h-3.5 w-3.5" />
                         : ch === 'whatsapp' ? <WaIcon className="h-3.5 w-3.5" />
                         : <MessageSquare className="h-3.5 w-3.5" />}
                        <span className="capitalize">{ch}</span>
                        {selected && <Check className="h-3 w-3 ml-0.5" />}
                      </button>
                    );
                  })}
                  {effectivePolicy.fallback.length === 0 && (
                    <span className="text-xs text-muted-foreground/60 py-2">No fallback — primary channel only</span>
                  )}
                </div>
              </div>

              {/* WhatsApp retry settings */}
              <div className="space-y-3 pt-2 border-t border-border">
                <div>
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 text-orange-400" />
                    WhatsApp OTP Retry Intelligence
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    If a WhatsApp OTP stays in <span className="text-blue-400 font-medium">Sent</span> (unconfirmed) after the retry window, the retry engine automatically triggers the fallback channel and logs a new delivery attempt.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Max retries</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={effectivePolicy.whatsappMaxRetries ?? 2}
                      onChange={e => setLocalPolicy({ ...effectivePolicy, whatsappMaxRetries: Math.max(0, Math.min(10, Number(e.target.value))) })}
                      data-testid="input-whatsapp-max-retries"
                      className="h-8"
                    />
                    <p className="text-[10px] text-muted-foreground">0 = disabled</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Retry after (minutes)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={effectivePolicy.whatsappRetryAfterMin ?? 3}
                      onChange={e => setLocalPolicy({ ...effectivePolicy, whatsappRetryAfterMin: Math.max(1, Math.min(60, Number(e.target.value))) })}
                      data-testid="input-whatsapp-retry-after"
                      className="h-8"
                    />
                    <p className="text-[10px] text-muted-foreground">Minutes before first retry fires</p>
                  </div>
                </div>
                <div className="rounded-lg bg-orange-500/5 border border-orange-500/20 p-3 text-[11px] text-muted-foreground space-y-1">
                  <p className="text-orange-400 font-medium">How it works</p>
                  <p>When WhatsApp primary is active: OTP is sent → if still <span className="text-blue-400">Sent</span> after <span className="text-foreground/80">{effectivePolicy.whatsappRetryAfterMin ?? 3} min</span>, retry engine fires up to <span className="text-foreground/80">{effectivePolicy.whatsappMaxRetries ?? 2}x</span> using the configured fallback channel. Each retry is logged as a new row in the stream with a <span className="text-amber-400">Fallback</span> badge.</p>
                </div>
              </div>

              {/* Policy preview */}
              <div className="rounded-lg bg-muted/30 border border-border p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Policy Preview</p>
                <code className="text-xs text-foreground/80 font-mono">{JSON.stringify(effectivePolicy, null, 2)}</code>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={policyMutation.isPending || !localPolicy}
                  onClick={() => policyMutation.mutate(effectivePolicy)}
                  data-testid="button-save-policy"
                >
                  {policyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5 mr-1.5" />}
                  Save Policy
                </Button>
                {localPolicy && (
                  <Button size="sm" variant="outline" onClick={() => setLocalPolicy(null)}>
                    Reset
                  </Button>
                )}
              </div>
            </div>

            {/* WhatsApp provider info */}
            <div className="bg-card border border-emerald-500/20 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <WaIcon className="h-4 w-4 text-emerald-400" />
                <p className="text-sm font-semibold">WhatsApp Provider</p>
              </div>
              <p className="text-xs text-muted-foreground">
                WhatsApp messages are sent via the configured provider (UltraMsg or CallMeBot). Configure the provider in <strong>Settings → WhatsApp Alerts</strong>.
              </p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1">
                  <p className="font-medium">CallMeBot</p>
                  <p className="text-muted-foreground">Free, personal use, requires opt-in per number</p>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1">
                  <p className="font-medium">UltraMsg</p>
                  <p className="text-muted-foreground">Paid, business use, no per-number opt-in needed</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PROFILES TAB ── */}
        {activeTab === 'profiles' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">HTTP Profiles</p>
                <p className="text-xs text-muted-foreground mt-0.5">Each profile has its own API key, secret, and REVE server URL. DLR endpoint is shared across all profiles.</p>
              </div>
              <Button size="sm" onClick={() => setShowAddForm(v => !v)} data-testid="button-add-profile">
                <Plus className="h-3.5 w-3.5 mr-1.5" />Add Profile
              </Button>
            </div>

            {/* Add form */}
            {showAddForm && (
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-5 space-y-4">
                <p className="text-sm font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4 text-sky-400" />New HTTP Profile</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Profile Name</Label>
                    <Input placeholder="e.g. Termination Profile" value={newProfile.name} onChange={e => setNewProfile(f => ({ ...f, name: e.target.value }))} data-testid="input-profile-name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">REVE Server URL</Label>
                    <Input placeholder="http://149.20.185.6/BhaooSMSV5" value={newProfile.baseUrl} onChange={e => setNewProfile(f => ({ ...f, baseUrl: e.target.value }))} data-testid="input-profile-url" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">API Key</Label>
                    <Input placeholder="API Key" value={newProfile.apiKey} onChange={e => setNewProfile(f => ({ ...f, apiKey: e.target.value }))} data-testid="input-profile-apikey" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Secret Key</Label>
                    <Input type="password" placeholder="Secret Key" value={newProfile.secretKey} onChange={e => setNewProfile(f => ({ ...f, secretKey: e.target.value }))} data-testid="input-profile-secret" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newProfile.isDefault}
                      onChange={e => setNewProfile(f => ({ ...f, isDefault: e.target.checked }))}
                      className="rounded"
                      data-testid="checkbox-profile-default"
                    />
                    Set as default profile
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!newProfile.name || !newProfile.apiKey || !newProfile.secretKey || addProfileMutation.isPending}
                    onClick={() => addProfileMutation.mutate(newProfile)}
                    data-testid="button-save-profile"
                  >
                    {addProfileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5 mr-1.5" />}
                    Save Profile
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Profile list */}
            {profilesLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => <div key={i} className="h-28 bg-card border border-border rounded-xl animate-pulse" />)}
              </div>
            ) : !profiles || profiles.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <Settings2 className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">No profiles yet</p>
                <p className="text-xs text-muted-foreground/60">Add a profile to manage multiple BhaooSMS HTTP accounts</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {profiles.map(p => (
                  <ProfileCard
                    key={p.id}
                    profile={p}
                    testingId={testingId}
                    onTest={handleTestProfile}
                    onDelete={id => deleteProfileMutation.mutate(id)}
                    onToggle={(id, isActive) => toggleProfileMutation.mutate({ id, isActive })}
                  />
                ))}
              </div>
            )}

            {/* DLR info */}
            <DlrUrlBox />
          </div>
        )}

      </div>
    </div>
  );
}
