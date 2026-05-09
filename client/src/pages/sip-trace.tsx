import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  GitBranch, Search, Upload, AlertTriangle, Clock, ArrowRight, ArrowLeft,
  Phone, PhoneOff, User, Globe, DollarSign, Monitor, Copy, Check,
  ChevronDown, ChevronUp, Info, RefreshCw, Wifi, Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SipEvent {
  ts: string;
  method: string;
  code?: number;
  from: string;
  to: string;
  direction: "lr" | "rl";
  detail: string;
}

interface CdrInfo {
  callId: string; caller: string; callee: string; callerIn?: string; calleeIn?: string;
  startTime: string; connectTime?: string; disconnectTime?: string;
  duration: number; totalDuration?: number; pdd?: number; pdd1xx?: number;
  cost: number; result: string; country?: string; remoteIp?: string;
  userAgent?: string; releaseSource?: string; clientName?: string; vendorName?: string;
  iCdr?: string; iCall?: string; protocol?: string;
}

interface CdrTraceResult { cdr: CdrInfo; sipEvents: SipEvent[] }

// ── Paste-based SIP parser (legacy mode) ──────────────────────────────────────

interface SipMessage {
  seq: number; timestamp: string; from: string; to: string;
  method: string; code?: number; cseq?: string; callId?: string; raw: string;
}

const SAMPLE_TRACE = `2026-05-08 10:00:00.000 INVITE sip:+12633887383@191.101.30.107 SIP/2.0
Via: SIP/2.0/UDP 45.59.163.182:5060;branch=z9hG4bK-abc123
From: <sip:PUSHTOTALK@191.101.30.107>;tag=12345
To: <sip:+12633887383@191.101.30.107>
Call-ID: abc123@45.59.163.182
CSeq: 1 INVITE

2026-05-08 10:00:00.050 SIP/2.0 100 Trying
Call-ID: abc123@45.59.163.182

2026-05-08 10:00:00.230 SIP/2.0 180 Ringing
Call-ID: abc123@45.59.163.182

2026-05-08 10:00:04.810 SIP/2.0 200 OK
Call-ID: abc123@45.59.163.182
CSeq: 1 INVITE

2026-05-08 10:00:04.820 ACK sip:+12633887383@191.101.30.107 SIP/2.0
Call-ID: abc123@45.59.163.182

2026-05-08 10:00:35.100 BYE sip:+12633887383@191.101.30.107 SIP/2.0
Call-ID: abc123@45.59.163.182

2026-05-08 10:00:35.115 SIP/2.0 200 OK
Call-ID: abc123@45.59.163.182
CSeq: 3 BYE`;

function parseSipTrace(raw: string): SipMessage[] {
  if (!raw.trim()) return [];
  const blocks = raw.split(/\n\s*\n/);
  const msgs: SipMessage[] = [];
  let seq = 0;
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.trim().split('\n');
    const firstLine = lines[0] || '';
    let timestamp = '';
    let method = '';
    let code: number | undefined;
    let from = 'UA';
    let to = 'Sippy';

    const tsMatch = firstLine.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
    if (tsMatch) timestamp = tsMatch[1];

    if (/SIP\/2\.0\s+(\d{3})/.test(firstLine)) {
      const m = firstLine.match(/SIP\/2\.0\s+(\d{3})\s*(.*)/);
      code = m ? parseInt(m[1]) : undefined;
      method = m ? m[1] : 'RESPONSE';
      from = 'Sippy'; to = 'UA';
    } else {
      const m = firstLine.match(/(?:^\S+\s+)?(\w+)\s+sip:/i);
      method = m ? m[1].toUpperCase() : firstLine.split(' ').find(p => /^[A-Z]+$/.test(p)) || 'UNKNOWN';
      if (['BYE','CANCEL','ACK'].includes(method)) { from = 'UA'; to = 'Sippy'; }
    }

    const callId = lines.find(l => /^Call-ID:/i.test(l))?.split(':').slice(1).join(':').trim();
    const cseq   = lines.find(l => /^CSeq:/i.test(l))?.split(':').slice(1).join(':').trim();

    msgs.push({ seq: seq++, timestamp, from, to, method: method || 'UNKNOWN', code, callId, cseq, raw: block.trim() });
  }
  return msgs;
}

// ── Event colour / label helpers ──────────────────────────────────────────────

function evColor(ev: SipEvent | SipMessage): string {
  const code = (ev as any).code;
  const method = (ev as any).method?.toUpperCase?.() ?? '';
  if (method === 'INVITE' && !code)   return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  if (method === 'ACK')               return 'bg-slate-500/15 border-slate-500/30 text-slate-300';
  if (['BYE','CANCEL'].includes(method) && !code) return 'bg-orange-500/15 border-orange-500/30 text-orange-300';
  if (code === 100)                   return 'bg-slate-500/10 border-slate-400/20 text-slate-400';
  if (code === 180 || code === 183)   return 'bg-amber-500/15 border-amber-500/30 text-amber-300';
  if (code === 200)                   return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300';
  if (code >= 400 && code < 700)      return 'bg-red-500/15 border-red-500/30 text-red-300';
  return 'bg-muted/20 border-border/30 text-muted-foreground';
}

function evLabel(ev: SipEvent): string {
  if (ev.code) {
    const phrases: Record<number, string> = {
      100: 'Trying', 180: 'Ringing', 183: 'Session Progress',
      200: 'OK', 403: 'Forbidden', 404: 'Not Found',
      408: 'Timeout', 480: 'Temp Unavail', 486: 'Busy Here',
      488: 'Not Acceptable', 501: 'Not Impl', 502: 'Bad Gateway',
      503: 'Unavailable', 603: 'Decline',
    };
    return `${ev.code} ${phrases[ev.code] ?? ev.method}`;
  }
  return ev.method;
}

function fmtDurSec(s: number) {
  const sec = Math.round(s || 0);
  return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
}

function fmtCurrency(v: number) {
  return (v || 0).toFixed(7);
}

// ── SIP Ladder — CDR mode ─────────────────────────────────────────────────────

function SipLadder({ events, uaLabel }: { events: SipEvent[]; uaLabel: string }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="font-mono text-xs space-y-0.5">
      {/* Header row */}
      <div className="grid grid-cols-[80px_1fr_80px] gap-2 pb-2 border-b border-border/40 mb-2">
        <div className="text-center text-muted-foreground font-semibold truncate" title={uaLabel}>
          {uaLabel.length > 12 ? uaLabel.slice(0, 10) + '…' : uaLabel}
        </div>
        <div className="text-center text-muted-foreground/50 text-[10px]">← messages →</div>
        <div className="text-center text-muted-foreground font-semibold">Sippy</div>
      </div>

      {events.map((ev, i) => {
        const isExpanded = expanded === i;
        const label = evLabel(ev);
        const colorClass = evColor(ev);

        return (
          <div key={i} className="group">
            <button
              onClick={() => setExpanded(isExpanded ? null : i)}
              className="w-full text-left hover:bg-muted/10 rounded transition-colors"
              data-testid={`sip-event-${i}`}
            >
              <div className="grid grid-cols-[80px_1fr_80px] gap-2 items-center py-1">
                {/* Left (UA) column */}
                <div className={cn(
                  "text-center text-[10px] px-1 py-0.5 rounded border truncate",
                  ev.direction === 'lr' ? colorClass : 'opacity-0'
                )}>
                  {ev.direction === 'lr' ? label : ''}
                </div>

                {/* Middle arrow */}
                <div className="flex items-center gap-1 relative">
                  <div className="flex-1 h-px bg-border/40 group-hover:bg-border/60 transition-colors" />
                  <span className="text-[10px] text-muted-foreground/50 absolute left-1/2 -translate-x-1/2 -top-3.5 whitespace-nowrap">
                    {ev.ts}
                  </span>
                  {ev.direction === 'lr'
                    ? <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    : <ArrowLeft  className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                  <div className="flex-1 h-px bg-border/40 group-hover:bg-border/60 transition-colors" />
                </div>

                {/* Right (Sippy) column */}
                <div className={cn(
                  "text-center text-[10px] px-1 py-0.5 rounded border truncate",
                  ev.direction === 'rl' ? colorClass : 'opacity-0'
                )}>
                  {ev.direction === 'rl' ? label : ''}
                </div>
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="mx-2 mb-2 p-3 bg-muted/10 border border-border/30 rounded-lg">
                <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                  {ev.detail}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── SIP Ladder — paste mode ───────────────────────────────────────────────────

function PasteLadder({ messages }: { messages: SipMessage[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="font-mono text-xs space-y-0.5">
      <div className="grid grid-cols-[80px_1fr_80px] gap-2 pb-2 border-b border-border/40 mb-2">
        <div className="text-center text-muted-foreground font-semibold">UA / Client</div>
        <div className="text-center text-muted-foreground/50 text-[10px]">← messages →</div>
        <div className="text-center text-muted-foreground font-semibold">Sippy</div>
      </div>
      {messages.map((msg, i) => {
        const isLeft  = msg.from === 'UA';
        const colorClass = evColor(msg);
        const label = msg.code ? `${msg.code} ${msg.method}` : msg.method;
        return (
          <div key={i} className="group">
            <button onClick={() => setExpanded(expanded === i ? null : i)}
              className="w-full text-left hover:bg-muted/10 rounded transition-colors"
              data-testid={`paste-event-${i}`}>
              <div className="grid grid-cols-[80px_1fr_80px] gap-2 items-center py-1">
                <div className={cn("text-center text-[10px] px-1 py-0.5 rounded border truncate",
                  isLeft ? colorClass : 'opacity-0')}>{isLeft ? label : ''}</div>
                <div className="flex items-center gap-1 relative">
                  <div className="flex-1 h-px bg-border/40" />
                  {msg.timestamp && (
                    <span className="text-[10px] text-muted-foreground/50 absolute left-1/2 -translate-x-1/2 -top-3.5 whitespace-nowrap">
                      {msg.timestamp.slice(11) || msg.timestamp}
                    </span>
                  )}
                  {isLeft
                    ? <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    : <ArrowLeft  className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                  <div className="flex-1 h-px bg-border/40" />
                </div>
                <div className={cn("text-center text-[10px] px-1 py-0.5 rounded border truncate",
                  !isLeft ? colorClass : 'opacity-0')}>{!isLeft ? label : ''}</div>
              </div>
            </button>
            {expanded === i && (
              <div className="mx-2 mb-2 p-3 bg-muted/10 border border-border/30 rounded-lg">
                <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all">{msg.raw}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── CDR Metadata Panel ────────────────────────────────────────────────────────

function CdrMetaPanel({ cdr }: { cdr: CdrInfo }) {
  const isAnswered = (cdr.totalDuration ?? cdr.duration ?? 0) > 0;
  const [copied, setCopied] = useState(false);

  function copyCallId() {
    navigator.clipboard.writeText(cdr.callId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const fields: Array<{ label: string; value: string | undefined; icon?: any; mono?: boolean }> = [
    { label: 'Call-ID',    value: cdr.callId,           icon: GitBranch, mono: true },
    { label: 'Client',     value: cdr.clientName,        icon: User },
    { label: 'Vendor',     value: cdr.vendorName,        icon: Monitor },
    { label: 'Caller',     value: cdr.caller,            icon: Phone, mono: true },
    { label: 'Callee',     value: cdr.callee,            icon: PhoneOff, mono: true },
    { label: 'Result',     value: cdr.result },
    { label: 'Country',    value: cdr.country,           icon: Globe },
    { label: 'Duration',   value: isAnswered ? fmtDurSec(cdr.totalDuration ?? cdr.duration) : '-', mono: true },
    { label: 'PDD',        value: cdr.pdd != null ? `${cdr.pdd.toFixed(2)}s` : '-', mono: true },
    { label: 'Cost',       value: `$${fmtCurrency(cdr.cost)}`, icon: DollarSign, mono: true },
    { label: 'Remote IP',  value: cdr.remoteIp,          icon: Wifi, mono: true },
    { label: 'User-Agent', value: cdr.userAgent,         icon: Monitor },
    { label: 'Protocol',   value: cdr.protocol },
    { label: 'Release',    value: cdr.releaseSource },
    { label: 'Start Time', value: cdr.startTime ? new Date(cdr.startTime).toUTCString() : undefined, mono: true },
  ];

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">CDR Record</h3>
        <div className="flex items-center gap-2">
          <Badge variant={isAnswered ? "default" : "destructive"} className="text-[10px]">
            {isAnswered ? 'Answered' : 'Unanswered'}
          </Badge>
          <button onClick={copyCallId} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
            data-testid="button-copy-callid" title="Copy Call-ID">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        {fields.filter(f => f.value).map(f => (
          <div key={f.label}>
            <dt className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{f.label}</dt>
            <dd className={cn("text-xs text-foreground truncate", f.mono && "font-mono")} title={f.value}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SipTracePage() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const urlCallId = params.get('callId') || '';

  const [mode, setMode] = useState<'lookup' | 'paste'>(urlCallId ? 'lookup' : 'lookup');
  const [inputValue, setInputValue] = useState(urlCallId);
  const [cliValue, setCliValue]     = useState('');
  const [cldValue, setCldValue]     = useState('');
  const [searchedId, setSearchedId] = useState(urlCallId);
  const [pasteText, setPasteText]   = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { toast } = useToast();

  // Pre-trigger lookup if callId came from URL
  useEffect(() => {
    if (urlCallId) { setSearchedId(urlCallId); setInputValue(urlCallId); }
  }, [urlCallId]);

  function handleSearch() {
    const id = inputValue.trim();
    if (!id && !cliValue.trim() && !cldValue.trim()) {
      toast({ title: 'Enter a Call-ID, CLI, or CLD to search', variant: 'destructive' });
      return;
    }
    setSearchedId(id || `cli:${cliValue}:cld:${cldValue}`);
  }

  const parsedPaste = parseSipTrace(pasteText || '');

  // Build URL-keyed query — this is the single source of truth
  const queryUrl = `/api/sippy/cdr-trace?${new URLSearchParams({
    ...(searchedId && !searchedId.startsWith('cli:') ? { callId: searchedId } : {}),
    ...(cliValue ? { cli: cliValue } : {}),
    ...(cldValue ? { cld: cldValue } : {}),
  }).toString()}`;

  const cdrQuery = useQuery<CdrTraceResult>({
    queryKey: [queryUrl],
    enabled: !!(searchedId || (cliValue && cldValue)),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const traceData = cdrQuery.data;
  const uaLabel = traceData?.cdr.remoteIp || traceData?.cdr.caller || 'UA';

  return (
    <div className="flex flex-col gap-4 p-4 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
          <GitBranch className="h-4 w-4 text-blue-400" />
        </div>
        <div>
          <h1 className="text-base font-bold">SIP Trace Viewer</h1>
          <p className="text-xs text-muted-foreground">Reconstruct SIP dialog from Sippy CDR records — or paste a raw SIP capture</p>
        </div>
        {/* Mode switcher */}
        <div className="ml-auto flex items-center gap-1 p-1 bg-muted/30 rounded-lg border border-border/40">
          {(['lookup','paste'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              data-testid={`tab-${m}`}
              className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                mode === m ? "bg-background shadow text-foreground border border-border/60" : "text-muted-foreground hover:text-foreground")}>
              {m === 'lookup' ? '🔍 CDR Lookup' : '📋 Paste SIP Trace'}
            </button>
          ))}
        </div>
      </div>

      {/* ── CDR LOOKUP MODE ─────────────────────────────────────────────────── */}
      {mode === 'lookup' && (
        <div className="flex flex-col gap-4">
          {/* Search form */}
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    placeholder="Enter Call-ID (e.g. abc123@45.59.163.182)"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    className="font-mono text-sm"
                    data-testid="input-callid"
                  />
                </div>
                <Button onClick={handleSearch} disabled={cdrQuery.isFetching} data-testid="button-search-cdr">
                  {cdrQuery.isFetching
                    ? <RefreshCw className="h-4 w-4 animate-spin" />
                    : <Search className="h-4 w-4" />}
                  <span className="ml-2">Search Sippy</span>
                </Button>
              </div>

              {/* Advanced: CLI / CLD */}
              <button onClick={() => setShowAdvanced(o => !o)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
                data-testid="button-toggle-advanced">
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Search by CLI / CLD instead
              </button>
              {showAdvanced && (
                <div className="flex gap-2">
                  <Input placeholder="CLI (caller number)" value={cliValue} onChange={e => setCliValue(e.target.value)}
                    className="font-mono text-sm" data-testid="input-cli" />
                  <Input placeholder="CLD (callee number)" value={cldValue} onChange={e => setCldValue(e.target.value)}
                    className="font-mono text-sm" data-testid="input-cld" />
                </div>
              )}

              <p className="text-[11px] text-muted-foreground/60">
                <Info className="h-3 w-3 inline mr-1" />
                Searches the rolling 72-hour CDR cache first. If not found, makes a live query to Sippy.
              </p>
            </div>
          </div>

          {/* Results */}
          {cdrQuery.isFetching && (
            <div className="rounded-xl border border-border/50 bg-card/50 p-6 flex flex-col gap-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {cdrQuery.isError && !cdrQuery.isFetching && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-300">CDR Not Found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {(cdrQuery.error as any)?.message || 'No CDR found matching that identifier.'}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-2">
                  The CDR cache holds the most recent 72 hours. Older calls require a direct date-range query on the CDR report page.
                </p>
              </div>
            </div>
          )}

          {traceData && !cdrQuery.isFetching && (
            <div className="flex flex-col gap-4">
              {/* SIP Ladder */}
              <div className="rounded-xl border border-border/50 bg-card/50 p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-blue-400" />
                    SIP Dialog Reconstruction
                  </h2>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {traceData.sipEvents.length} events
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">Click event to expand</span>
                  </div>
                </div>
                <div className="bg-muted/5 rounded-lg border border-border/30 p-4 overflow-x-auto">
                  <SipLadder events={traceData.sipEvents} uaLabel={uaLabel} />
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-3 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Reconstructed from Sippy CDR timing fields (setup_time, connect_time, disconnect_time, pdd, pdd1xx).
                  Actual SIP headers require a raw packet capture (PCAP).
                </p>
              </div>

              {/* CDR Metadata */}
              <CdrMetaPanel cdr={traceData.cdr} />
            </div>
          )}

          {!searchedId && !cdrQuery.isFetching && !traceData && (
            <div className="rounded-xl border border-border/30 border-dashed bg-muted/5 p-10 text-center">
              <GitBranch className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Enter a Call-ID above to reconstruct the SIP dialog</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Or navigate here from the CDR report — each row has a
                <GitBranch className="h-3 w-3 inline mx-1" />
                Trace link
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── PASTE MODE ──────────────────────────────────────────────────────── */}
      {mode === 'paste' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Upload className="h-4 w-4 text-muted-foreground" />
                Paste Raw SIP Trace
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setPasteText(SAMPLE_TRACE)}
                data-testid="button-load-sample">Load Sample</Button>
            </div>
            <Textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="Paste SIP messages here — one blank line between each message block..."
              className="font-mono text-xs min-h-[180px] resize-y"
              data-testid="textarea-sip-paste"
            />
            {pasteText && (
              <p className="text-[11px] text-muted-foreground mt-2">
                {parsedPaste.length} message{parsedPaste.length !== 1 ? 's' : ''} parsed
              </p>
            )}
          </div>

          {parsedPaste.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card/50 p-4">
              <h2 className="text-sm font-semibold mb-4">SIP Ladder</h2>
              <div className="bg-muted/5 rounded-lg border border-border/30 p-4">
                <PasteLadder messages={parsedPaste} />
              </div>
            </div>
          )}

          {!pasteText && (
            <div className="rounded-xl border border-border/30 border-dashed bg-muted/5 p-10 text-center">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Paste SIP trace output above to visualise the call flow</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
