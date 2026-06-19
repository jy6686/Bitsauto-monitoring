import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  GitBranch, Search, Upload, AlertTriangle, Clock, ArrowRight, ArrowLeft,
  Phone, PhoneOff, User, Globe, DollarSign, Monitor, Copy, Check,
  ChevronDown, ChevronUp, Info, RefreshCw, Wifi, Radio, Music2, Layers,
  Download, FileText, FileSpreadsheet, ShieldAlert, Hash, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Download helpers ──────────────────────────────────────────────────────────

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 500);
}

function sipMessagesToCsv(msgs: SipMessage[]): string {
  const header = ['Seq','Timestamp','From','To','Method','Code','CSeq','Call-ID'];
  const rows = msgs.map(m => [
    m.seq, m.timestamp, m.from, m.to, m.method,
    m.code ?? '', m.cseq ?? '', m.callId ?? '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [header.join(','), ...rows].join('\r\n');
}

function sipEventsToCsv(events: SipEvent[]): string {
  const header = ['Seq','Timestamp','From','To','Method','Code','Detail'];
  const rows = events.map((e, i) => [
    i + 1, e.ts, e.from, e.to, e.method,
    e.code ?? '', (e.detail ?? '').replace(/\r?\n/g, ' '),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [header.join(','), ...rows].join('\r\n');
}

function sipMessagesToTxt(msgs: SipMessage[], callId?: string): string {
  const lines: string[] = [
    '=== SIP Trace Export ===',
    `Exported: ${new Date().toUTCString()}`,
    callId ? `Call-ID: ${callId}` : '',
    `Messages: ${msgs.length}`,
    ''.padEnd(60, '-'),
    '',
  ];
  for (const m of msgs) {
    lines.push(`[${m.seq}] ${m.timestamp}  ${m.from} → ${m.to}  ${m.method}${m.code ? ` ${m.code}` : ''}`);
    if (m.cseq)   lines.push(`    CSeq:    ${m.cseq}`);
    if (m.callId) lines.push(`    Call-ID: ${m.callId}`);
    lines.push('');
    lines.push(m.raw);
    lines.push(''.padEnd(60, '-'));
    lines.push('');
  }
  return lines.join('\n');
}

function sipEventsToTxt(events: SipEvent[], cdr?: CdrInfo): string {
  const lines: string[] = [
    '=== SIP Trace Export (Reconstructed from Sippy CDR) ===',
    `Exported: ${new Date().toUTCString()}`,
    cdr ? `Call-ID: ${cdr.callId}` : '',
    cdr ? `Caller:  ${cdr.caller}  →  Callee: ${cdr.callee}` : '',
    cdr ? `Result:  ${cdr.result}` : '',
    `Events:  ${events.length}`,
    ''.padEnd(60, '-'),
    '',
  ];
  let prev = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const tsMs = tsToMs(ev.ts);
    const delta = prev > 0 && tsMs > 0 ? `+${tsMs - prev}ms` : '';
    prev = tsMs || prev;
    lines.push(`[${i + 1}] ${ev.ts}  ${delta}`);
    lines.push(`    ${ev.from} → ${ev.to}  ${ev.method}${ev.code ? ` ${ev.code}` : ''}`);
    if (ev.detail) { lines.push(''); lines.push(ev.detail); }
    lines.push(''.padEnd(60, '-'));
    lines.push('');
  }
  return lines.join('\n');
}

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

// Whether a SIP event traverses the carrier leg (not just Sippy-local)
function eventInvolvesCarrier(ev: SipEvent | SipMessage): boolean {
  const m = (ev.method ?? '').toUpperCase();
  const code = (ev as any).code as number | undefined;
  if (['INVITE', 'BYE', 'CANCEL', 'ACK', 'UPDATE', 'PRACK'].includes(m)) return true;
  if (code && code >= 180) return true;
  return false;
}

// Parse a SIP timestamp string → ms epoch (best-effort)
function tsToMs(ts: string): number {
  if (!ts) return 0;
  const n = Number(ts);
  if (!isNaN(n)) return n;
  const d = new Date(ts.replace(' ', 'T'));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function SipLadder({ events, uaLabel, cdr }: { events: SipEvent[]; uaLabel: string; cdr?: CdrInfo }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  // PDD: INVITE → 200 OK delta (prefer CDR field, fall back to event timestamps)
  const pddMs: number | null = (() => {
    if (cdr?.pdd != null && cdr.pdd > 0) return Math.round(cdr.pdd * 1000);
    const invite = events.find(e => e.method === 'INVITE' && !e.code);
    const ok     = events.find(e => e.code === 200);
    if (!invite || !ok) return null;
    const diff = tsToMs(ok.ts) - tsToMs(invite.ts);
    return diff > 0 ? diff : null;
  })();

  const isAnswered = (cdr?.totalDuration ?? cdr?.duration ?? 0) > 0;

  // Grid template — 6 cols: Caller | left-lane | Sippy-dot | right-lane | Carrier | Δms
  const GRID = 'grid grid-cols-[88px_1fr_44px_1fr_88px_46px]';

  return (
    <div className="font-mono text-xs">
      {/* PDD + result summary bar */}
      {(pddMs !== null || cdr?.result) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 pb-2.5 border-b border-border/40 text-[11px]">
          {pddMs !== null && (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">PDD</span>
              <span className={cn("font-semibold tabular-nums",
                pddMs > 5000 ? "text-red-400" : pddMs > 2000 ? "text-amber-400" : "text-emerald-400")}>
                {pddMs >= 1000 ? `${(pddMs / 1000).toFixed(2)}s` : `${pddMs}ms`}
              </span>
            </span>
          )}
          {cdr?.result && (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Result</span>
              <span className={cn("font-semibold capitalize",
                isAnswered ? "text-emerald-400" : "text-red-400")}>
                {cdr.result}
              </span>
            </span>
          )}
          {cdr?.pdd != null && cdr.pdd > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">PDD (1xx)</span>
              <span className="font-semibold tabular-nums text-purple-400">
                {cdr.pdd1xx != null ? `${cdr.pdd1xx.toFixed(2)}s` : '—'}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Header row */}
      <div className={cn(GRID, "gap-1 pb-2 border-b border-border/40 mb-1")}>
        <div className="text-center text-muted-foreground font-semibold truncate text-[11px] px-1"
          title={uaLabel}>
          {uaLabel.length > 12 ? uaLabel.slice(0, 10) + '…' : uaLabel}
        </div>
        <div />
        <div className="text-center">
          <span className="text-[11px] font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/25 rounded px-1.5 py-0.5">
            Sippy
          </span>
        </div>
        <div />
        <div className="text-center text-muted-foreground font-semibold text-[11px]">Carrier</div>
        <div className="text-center text-muted-foreground/40 text-[9px] uppercase tracking-wide">Δ</div>
      </div>

      <div className="space-y-0">
        {events.map((ev, i) => {
          const isExpanded = expanded === i;
          const label      = evLabel(ev);
          const colorClass = evColor(ev);
          const isError    = (ev.code ?? 0) >= 400;
          const carrier    = eventInvolvesCarrier(ev);

          // Delta from previous event
          let deltaMs: number | null = null;
          if (i > 0) {
            const t1 = tsToMs(events[i - 1].ts);
            const t2 = tsToMs(ev.ts);
            if (t1 > 0 && t2 > 0) deltaMs = t2 - t1;
          }

          const arrowColor = isError
            ? 'text-red-400'
            : 'text-muted-foreground/70 group-hover:text-muted-foreground';
          const lineColor = isError
            ? 'bg-red-500/35'
            : 'bg-border/40 group-hover:bg-border/60';

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18, delay: i * 0.035 }}
              className={cn(
                "group rounded transition-colors",
                isError && "bg-red-500/8 border-l-2 border-red-500/50 pl-0.5"
              )}
            >
              <button
                onClick={() => setExpanded(isExpanded ? null : i)}
                className="w-full text-left hover:bg-muted/10 rounded transition-colors"
                data-testid={`sip-event-${i}`}
              >
                <div className={cn(GRID, "gap-1 items-center py-1.5")}>
                  {/* Caller column */}
                  <div className={cn(
                    "text-center text-[10px] px-1 py-0.5 rounded border truncate transition-opacity",
                    ev.direction === 'lr' ? colorClass : 'opacity-0'
                  )}>
                    {ev.direction === 'lr' ? label : '·'}
                  </div>

                  {/* Left arrow lane: Caller ↔ Sippy */}
                  <div className="flex items-center relative min-h-[18px]">
                    <div className={cn("flex-1 h-px transition-colors", lineColor)} />
                    {ev.direction === 'lr'
                      ? <ArrowRight className={cn("h-3 w-3 flex-shrink-0 transition-colors", arrowColor)} />
                      : <ArrowLeft  className={cn("h-3 w-3 flex-shrink-0 transition-colors", arrowColor)} />}
                    <div className={cn("flex-1 h-px transition-colors", lineColor)} />
                    <span className="text-[9px] text-muted-foreground/40 absolute left-1/2 -translate-x-1/2 -top-3.5 whitespace-nowrap pointer-events-none">
                      {ev.ts ? ev.ts.slice(11) : ''}
                    </span>
                  </div>

                  {/* Sippy center node */}
                  <div className="flex justify-center">
                    <div className={cn(
                      "h-3.5 w-3.5 rounded-full border-2 transition-colors",
                      isError
                        ? "bg-red-500/30 border-red-500/60"
                        : "bg-blue-500/20 border-blue-500/40"
                    )} />
                  </div>

                  {/* Right arrow lane: Sippy ↔ Carrier */}
                  <div className="flex items-center min-h-[18px]">
                    {carrier ? (
                      <>
                        <div className={cn("flex-1 h-px", isError ? "bg-red-500/30" : "bg-border/30")} />
                        {ev.direction === 'lr'
                          ? <ArrowRight className={cn("h-3 w-3 flex-shrink-0", isError ? "text-red-400/70" : "text-muted-foreground/50")} />
                          : <ArrowLeft  className={cn("h-3 w-3 flex-shrink-0", isError ? "text-red-400/70" : "text-muted-foreground/50")} />}
                        <div className={cn("flex-1 h-px", isError ? "bg-red-500/30" : "bg-border/30")} />
                      </>
                    ) : (
                      <div className="flex-1 border-dashed border-t border-border/15" />
                    )}
                  </div>

                  {/* Carrier column */}
                  <div className={cn(
                    "text-center text-[10px] px-1 py-0.5 rounded border truncate transition-opacity",
                    !carrier
                      ? 'opacity-0'
                      : ev.direction === 'rl'
                        ? colorClass
                        : 'border-border/20 text-muted-foreground/35'
                  )}>
                    {!carrier ? '·' : ev.direction === 'rl' ? label : '→fwd'}
                  </div>

                  {/* Delta ms */}
                  <div className="text-center text-[9px] tabular-nums text-muted-foreground/45">
                    {deltaMs !== null ? (deltaMs >= 1000 ? `+${(deltaMs / 1000).toFixed(1)}s` : `+${deltaMs}`) : '—'}
                  </div>
                </div>
              </button>

              <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden mx-2 mb-1.5"
                >
                  <pre className="p-3 bg-muted/10 border border-border/30 rounded-lg text-[11px] text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                    {ev.detail}
                  </pre>
                </motion.div>
              )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── SIP Ladder — paste mode ───────────────────────────────────────────────────

function PasteLadder({ messages }: { messages: SipMessage[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  // PDD: INVITE → 200 OK
  const pddMs: number | null = (() => {
    const invite = messages.find(m => m.method === 'INVITE' && !m.code);
    const ok     = messages.find(m => m.code === 200);
    if (!invite || !ok) return null;
    const diff = tsToMs(ok.timestamp) - tsToMs(invite.timestamp);
    return diff > 0 ? diff : null;
  })();

  const GRID = 'grid grid-cols-[88px_1fr_44px_1fr_88px_46px]';

  return (
    <div className="font-mono text-xs">
      {/* PDD summary */}
      {pddMs !== null && (
        <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-border/40 text-[11px]">
          <span className="text-muted-foreground">PDD</span>
          <span className={cn("font-semibold tabular-nums",
            pddMs > 5000 ? "text-red-400" : pddMs > 2000 ? "text-amber-400" : "text-emerald-400")}>
            {pddMs >= 1000 ? `${(pddMs / 1000).toFixed(2)}s` : `${pddMs}ms`}
          </span>
        </div>
      )}

      {/* Header */}
      <div className={cn(GRID, "gap-1 pb-2 border-b border-border/40 mb-1")}>
        <div className="text-center text-muted-foreground font-semibold text-[11px]">UA / Caller</div>
        <div />
        <div className="text-center">
          <span className="text-[11px] font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/25 rounded px-1.5 py-0.5">
            Sippy
          </span>
        </div>
        <div />
        <div className="text-center text-muted-foreground font-semibold text-[11px]">Carrier</div>
        <div className="text-center text-muted-foreground/40 text-[9px] uppercase tracking-wide">Δ</div>
      </div>

      <div className="space-y-0">
        {messages.map((msg, i) => {
          const isLeft     = msg.from === 'UA';
          const colorClass = evColor(msg);
          const label      = msg.code ? `${msg.code} ${msg.method}` : msg.method;
          const isError    = (msg.code ?? 0) >= 400;
          const carrier    = eventInvolvesCarrier(msg);

          let deltaMs: number | null = null;
          if (i > 0) {
            const t1 = tsToMs(messages[i - 1].timestamp);
            const t2 = tsToMs(msg.timestamp);
            if (t1 > 0 && t2 > 0) deltaMs = t2 - t1;
          }

          const lineColor = isError ? 'bg-red-500/35' : 'bg-border/40 group-hover:bg-border/60';
          const arrowColor = isError ? 'text-red-400' : 'text-muted-foreground/70 group-hover:text-muted-foreground';

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18, delay: i * 0.035 }}
              className={cn(
                "group rounded transition-colors",
                isError && "bg-red-500/8 border-l-2 border-red-500/50 pl-0.5"
              )}
            >
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="w-full text-left hover:bg-muted/10 rounded transition-colors"
                data-testid={`paste-event-${i}`}
              >
                <div className={cn(GRID, "gap-1 items-center py-1.5")}>
                  {/* Caller column */}
                  <div className={cn("text-center text-[10px] px-1 py-0.5 rounded border truncate",
                    isLeft ? colorClass : 'opacity-0')}>
                    {isLeft ? label : '·'}
                  </div>

                  {/* Left arrow lane */}
                  <div className="flex items-center relative min-h-[18px]">
                    <div className={cn("flex-1 h-px transition-colors", lineColor)} />
                    {isLeft
                      ? <ArrowRight className={cn("h-3 w-3 flex-shrink-0 transition-colors", arrowColor)} />
                      : <ArrowLeft  className={cn("h-3 w-3 flex-shrink-0 transition-colors", arrowColor)} />}
                    <div className={cn("flex-1 h-px transition-colors", lineColor)} />
                    {msg.timestamp && (
                      <span className="text-[9px] text-muted-foreground/40 absolute left-1/2 -translate-x-1/2 -top-3.5 whitespace-nowrap pointer-events-none">
                        {msg.timestamp.slice(11) || msg.timestamp}
                      </span>
                    )}
                  </div>

                  {/* Sippy center node */}
                  <div className="flex justify-center">
                    <div className={cn(
                      "h-3.5 w-3.5 rounded-full border-2 transition-colors",
                      isError ? "bg-red-500/30 border-red-500/60" : "bg-blue-500/20 border-blue-500/40"
                    )} />
                  </div>

                  {/* Right arrow lane */}
                  <div className="flex items-center min-h-[18px]">
                    {carrier ? (
                      <>
                        <div className={cn("flex-1 h-px", isError ? "bg-red-500/30" : "bg-border/30")} />
                        {isLeft
                          ? <ArrowRight className={cn("h-3 w-3 flex-shrink-0", isError ? "text-red-400/70" : "text-muted-foreground/50")} />
                          : <ArrowLeft  className={cn("h-3 w-3 flex-shrink-0", isError ? "text-red-400/70" : "text-muted-foreground/50")} />}
                        <div className={cn("flex-1 h-px", isError ? "bg-red-500/30" : "bg-border/30")} />
                      </>
                    ) : (
                      <div className="flex-1 border-dashed border-t border-border/15" />
                    )}
                  </div>

                  {/* Carrier column */}
                  <div className={cn("text-center text-[10px] px-1 py-0.5 rounded border truncate",
                    !carrier
                      ? 'opacity-0'
                      : !isLeft
                        ? colorClass
                        : 'border-border/20 text-muted-foreground/35')}>
                    {!carrier ? '·' : !isLeft ? label : '→fwd'}
                  </div>

                  {/* Delta ms */}
                  <div className="text-center text-[9px] tabular-nums text-muted-foreground/45">
                    {deltaMs !== null ? (deltaMs >= 1000 ? `+${(deltaMs / 1000).toFixed(1)}s` : `+${deltaMs}`) : '—'}
                  </div>
                </div>
              </button>

              <AnimatePresence>
              {expanded === i && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden mx-2 mb-1.5"
                >
                  <pre className="p-3 bg-muted/10 border border-border/30 rounded-lg text-[11px] text-muted-foreground whitespace-pre-wrap break-all">{msg.raw}</pre>
                </motion.div>
              )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── SDP / Codec Negotiation Panel ────────────────────────────────────────────

interface SdpRecord {
  timeStamp?: string;
  iCallsSdp?: number;
  iCdrsConnection?: number;
  sipMsgType?: string;
  sdp?: string;
}

function parseSdpText(raw: string | undefined): { mediaType: string; codecs: string[]; connectionIp: string; direction: string } {
  if (!raw) return { mediaType: '', codecs: [], connectionIp: '', direction: '' };
  const lines = raw.split(/\r?\n/);
  let mediaType = '';
  let connectionIp = '';
  let direction = '';
  const codecs: string[] = [];
  const ptNames: Record<string, string> = {};
  const ptList: string[] = [];

  for (const line of lines) {
    if (line.startsWith('m=')) {
      const parts = line.slice(2).split(' ');
      mediaType = parts[0] || '';
      ptList.push(...parts.slice(3));
    }
    if (line.startsWith('c=IN IP4 ') || line.startsWith('c=IN IP6 ')) {
      connectionIp = line.split(' ')[2] || '';
    }
    if (line.startsWith('a=rtpmap:')) {
      const rest = line.slice(9);
      const spIdx = rest.indexOf(' ');
      if (spIdx !== -1) {
        const pt = rest.slice(0, spIdx);
        const name = rest.slice(spIdx + 1).split('/')[0];
        ptNames[pt] = name;
      }
    }
    if (line.startsWith('a=sendrecv')) direction = 'sendrecv';
    if (line.startsWith('a=sendonly')) direction = 'sendonly';
    if (line.startsWith('a=recvonly')) direction = 'recvonly';
    if (line.startsWith('a=inactive')) direction = 'inactive';
  }

  for (const pt of ptList) {
    const name = ptNames[pt];
    if (name && !codecs.includes(name)) codecs.push(name);
  }

  return { mediaType, codecs, connectionIp, direction };
}

function SdpPanel({ iCall }: { iCall: string | undefined }) {
  const { data, isLoading, isError } = useQuery<{ records: SdpRecord[] }>({
    queryKey: ['/api/sippy/cdr/sdp', iCall],
    queryFn: () => fetch(`/api/sippy/cdr/sdp?iCall=${iCall}`).then(r => r.json()),
    enabled: !!iCall,
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (!iCall) return null;

  if (isLoading) return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-2">
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-16 w-full" />
    </div>
  );

  if (isError || !data?.records?.length) return (
    <div className="rounded-xl border border-border/30 bg-card/30 p-4 flex items-center gap-3">
      <Layers className="h-4 w-4 text-muted-foreground/40" />
      <p className="text-xs text-muted-foreground/60">No SDP records available from Sippy for this call. SDP data is only stored for calls handled by modern Sippy versions with SDP logging enabled.</p>
    </div>
  );

  const records = data.records;
  const callerSdps = records.filter(r => r.iCallsSdp != null);
  const calleeSdps = records.filter(r => r.iCdrsConnection != null);

  const offer  = callerSdps[0] ?? records[0];
  const answer = calleeSdps[0] ?? records[1];

  const offerInfo  = parseSdpText(offer?.sdp);
  const answerInfo = parseSdpText(answer?.sdp);

  const negotiatedCodecs = offerInfo.codecs.filter(c => answerInfo.codecs.includes(c));

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-card/50 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Music2 className="h-4 w-4 text-cyan-400" />
          Media Negotiation (SDP)
        </h3>
        <div className="flex items-center gap-2">
          {negotiatedCodecs.length > 0 && (
            <Badge className="text-[10px] bg-cyan-500/15 text-cyan-400 border-cyan-500/25">
              Active: {negotiatedCodecs[0]}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {records.length} SDP record{records.length !== 1 ? 's' : ''}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Offer */}
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ArrowRight className="h-3 w-3 text-blue-400" />
            SDP Offer (Caller)
          </p>
          {offerInfo.mediaType ? (
            <dl className="space-y-1.5">
              <div>
                <dt className="text-[10px] text-muted-foreground/60">Media type</dt>
                <dd className="text-xs font-mono text-foreground">{offerInfo.mediaType}</dd>
              </div>
              {offerInfo.codecs.length > 0 && (
                <div>
                  <dt className="text-[10px] text-muted-foreground/60">Codecs offered</dt>
                  <dd className="flex flex-wrap gap-1 mt-0.5">
                    {offerInfo.codecs.map(c => (
                      <span key={c} className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold",
                        negotiatedCodecs.includes(c) ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/30 text-muted-foreground"
                      )}>{c}</span>
                    ))}
                  </dd>
                </div>
              )}
              {offerInfo.connectionIp && (
                <div>
                  <dt className="text-[10px] text-muted-foreground/60">Media IP</dt>
                  <dd className="text-xs font-mono text-foreground">{offerInfo.connectionIp}</dd>
                </div>
              )}
              {offerInfo.direction && (
                <div>
                  <dt className="text-[10px] text-muted-foreground/60">Direction</dt>
                  <dd className="text-xs font-mono text-foreground">{offerInfo.direction}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground/50 italic">No media data</p>
          )}
        </div>

        {/* Answer */}
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ArrowLeft className="h-3 w-3 text-emerald-400" />
            SDP Answer (Carrier)
          </p>
          {answerInfo.mediaType ? (
            <dl className="space-y-1.5">
              <div>
                <dt className="text-[10px] text-muted-foreground/60">Media type</dt>
                <dd className="text-xs font-mono text-foreground">{answerInfo.mediaType}</dd>
              </div>
              {answerInfo.codecs.length > 0 && (
                <div>
                  <dt className="text-[10px] text-muted-foreground/60">Codecs accepted</dt>
                  <dd className="flex flex-wrap gap-1 mt-0.5">
                    {answerInfo.codecs.map(c => (
                      <span key={c} className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold",
                        negotiatedCodecs.includes(c) ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/30 text-muted-foreground"
                      )}>{c}</span>
                    ))}
                  </dd>
                </div>
              )}
              {answerInfo.connectionIp && (
                <div>
                  <dt className="text-[10px] text-muted-foreground/60">Media IP</dt>
                  <dd className="text-xs font-mono text-foreground">{answerInfo.connectionIp}</dd>
                </div>
              )}
              {answerInfo.direction && (
                <div>
                  <dt className="text-[10px] text-muted-foreground/60">Direction</dt>
                  <dd className="text-xs font-mono text-foreground">{answerInfo.direction}</dd>
                </div>
              )}
            </dl>
          ) : answer ? (
            <p className="text-xs text-muted-foreground/50 italic">Carrier SDP not stored</p>
          ) : (
            <p className="text-xs text-muted-foreground/50 italic">Call not answered — no SDP answer</p>
          )}
        </div>
      </div>

      {/* Full SDP details accordion for offer */}
      {offer?.sdp && (
        <details className="mt-3">
          <summary className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer select-none">
            View raw SDP ({records.length} records)
          </summary>
          <div className="mt-2 space-y-2">
            {records.map((r, i) => (
              <pre key={i} className="text-[10px] font-mono bg-muted/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all border border-border/30">
                {r.sipMsgType && <span className="text-cyan-400/80 block mb-1">[{r.sipMsgType}] {r.timeStamp}</span>}
                {r.sdp}
              </pre>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Diagnostic Analysis Panel ─────────────────────────────────────────────────

interface DiagFinding {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  fix?: string;
}

function DiagnosticPanel({ cdr, sipEvents, pasteMessages }: {
  cdr?: CdrInfo;
  sipEvents?: SipEvent[];
  pasteMessages?: SipMessage[];
}) {
  const findings: DiagFinding[] = [];

  // ── Analyse CDR-based signals ──────────────────────────────────────────────
  if (cdr) {
    const result = (cdr.result ?? '').toLowerCase();
    const prefix = (cdr as any).prefix ?? '';
    const isAnswered = (cdr.totalDuration ?? cdr.duration ?? 0) > 0;
    const has200 = sipEvents?.some(e => e.code === 200) || pasteMessages?.some(m => m.code === 200);

    // external_translation_error
    if (prefix === 'external_translation_error' || result.includes('translation')) {
      findings.push({
        severity: 'critical',
        title: 'Number Translation Failed (external_translation_error)',
        detail: `Sippy tried to apply a translation rule to the dialed number but no matching rule was found. The Prefix field in the CDR shows "${prefix}" instead of a dial prefix — this means the translation table for account #${cdr.iCdr ?? '?'} has no rule matching the incoming CLD (${cdr.callee ?? 'unknown'}). Sippy could not resolve a routable destination and rejected the call internally.`,
        fix: 'Check the Translation Rules on the originating account in Sippy. Ensure there is a rule matching the CLD format (e.g. +1XXXXXXXXXX or 1XXXXXXXXXX). Also verify the "Translation Error" action is set to "Reject" vs "Pass-Through" depending on intent.',
      });
    }

    // No Rate Found (-14)
    if (result.includes('no rate') || result.includes('-14')) {
      findings.push({
        severity: 'critical',
        title: 'No Rate Found in Tariff (Error -14)',
        detail: `Sippy looked up the tariff assigned to account #${cdr.iCdr ?? '?'} but found no rate entry matching the destination prefix. This typically happens when: (1) the number translation failed and produced an unroutable number, (2) the tariff is missing a rate for this prefix, or (3) the rate exists but is set to "Forbidden". Cost = $0.0000 confirms no billing occurred.`,
        fix: 'Open the tariff assigned to this account in Sippy and search for a prefix matching the CLD. Add the missing rate, or fix the translation rule so the correct prefix is produced before tariff lookup.',
      });
    }

    // 200 OK in SIP but call marked failed / zero duration
    if (has200 && !isAnswered && (result.includes('no rate') || result.includes('error') || result.includes('fail'))) {
      findings.push({
        severity: 'warning',
        title: 'Cause Code Mismatch — SIP 200 OK vs CDR Failure',
        detail: `The SIP trace shows a 200 OK response, which at the signaling layer means the far end acknowledged the request. However, the CDR result is "${cdr.result}" with Duration = 0:00 and identical Connect/Disconnect timestamps. This is NOT a contradiction — the 200 OK in the trace is the response to the BYE (disconnect acknowledgment), not the INVITE answer. Sippy internally terminated the call before any billable connection due to the tariff/translation failure, so the call never "connected" in the billing sense even though SIP signaling completed normally.`,
        fix: 'No SIP fix needed. The 200 OK is correct SIP behavior. Fix the underlying tariff or translation issue (see findings above) to allow calls to complete and bill correctly.',
      });
    }

    // Zero duration with non-zero PDD
    if (!isAnswered && (cdr.pdd ?? 0) > 0) {
      findings.push({
        severity: 'info',
        title: 'PDD Recorded but Call Never Billed',
        detail: `PDD of ${cdr.pdd?.toFixed(2)}s was recorded, meaning the call did progress through the SIP stack (INVITE was sent, possibly got provisional responses). But Duration = 0 means Sippy never started the billing clock — consistent with a billing/tariff rejection that happened at or before answer.`,
        fix: 'No separate fix. Resolving the tariff issue will allow the billing clock to start correctly on future calls.',
      });
    }

    // No Route Found
    if (result.includes('no route') || result.includes('route not found') || result.includes('-603') || result.includes('no_route')) {
      findings.push({
        severity: 'critical',
        title: 'No Route Found — Routing Group Misconfiguration',
        detail: `Sippy evaluated the routing group assigned to this account and found no matching outbound route for the destination. This is a routing-layer failure (not a tariff/billing failure). Common causes:\n\n1. The account has no routing group assigned — it inherits from its parent customer, whose routing group has no routes for this destination.\n2. The routing group exists but contains no active connections/vendors for this prefix.\n3. The routing group has connections but all are disabled, over capacity, or have CPS/session limits exhausted.\n4. A sub-account (e.g. PUSHTOTALK under RTST1) is inheriting the parent's routing group, which is not configured for outbound routing.\n\nKey distinction from "No Rate Found": a routing failure happens before billing — the call never reaches a carrier at all.`,
        fix: 'In Sippy admin: (1) Go to Accounts → find the originating account → check the "Routing Group" field. If blank, assign a routing group explicitly. (2) Open that routing group → verify it has at least one active Connection/Vendor entry with routes covering the destination prefix. (3) If this account is a sub-account under a customer (e.g. PUSHTOTALK under RTST1), ensure either the account itself has a dedicated routing group, or the parent customer\'s routing group is correctly configured for outbound calls.',
      });
    }

    // Sub-account inheriting parent routing — detected when account is a known sub-account
    const acctName = (cdr as any).accountName || (cdr as any).clientName || '';
    if (acctName && ['pushtotalk','aircel','asif'].some(n => acctName.toLowerCase().includes(n))) {
      findings.push({
        severity: 'warning',
        title: `Sub-Account Routing Inheritance — ${acctName} under RTST1`,
        detail: `"${acctName}" is a sub-account under the RTST1 customer (iCustomer=2). In Sippy's account hierarchy, sub-accounts that do not have an explicit routing group set will inherit the parent customer's (RTST1's) routing group and tariff. If RTST1's routing group is not configured for the destination this account is trying to reach, the call will fail with "No Route Found" even though the account itself appears correctly configured.\n\nThis also explains why the call appears to follow RTST1's tariff and routing configuration — it IS using RTST1's settings because no override is set on the sub-account.`,
        fix: `In Sippy: Go to Accounts → search for "${acctName}" → Edit → set a dedicated "Routing Group" and "Service Plan/Tariff" specific to this account. Do not leave these blank if you need different routing from the parent RTST1 customer. Then verify that the assigned routing group has active connections covering the required destination prefixes.`,
      });
    }

    // Number normalisation issue — CLD without + prefix
    const cldNum = cdr.callee ?? '';
    if (cldNum && !cldNum.startsWith('+') && /^\d{7,15}$/.test(cldNum)) {
      findings.push({
        severity: 'info',
        title: 'Possible Number Normalisation Issue — Missing + Prefix',
        detail: `The CLD in the CDR is "${cldNum}" without a leading + sign. Sippy's tariff lookup may be prefix-matching against "+${cldNum.slice(0, 4)}…" style entries. If the tariff rates are defined with a + prefix and the translated number arrives without one, no match will be found. This can silently cause "No Rate Found" even when the rate entry exists.`,
        fix: 'Verify how rates are entered in the tariff (with or without +). Ensure translation rules output numbers in the same format as tariff prefixes (e.g. both use E.164 with + or both without).',
      });
    }
  }

  // ── Analyse paste-mode signals (no CDR) ───────────────────────────────────
  if (!cdr && pasteMessages && pasteMessages.length > 0) {
    const has200ForInvite = pasteMessages.some(m => m.code === 200 && m.cseq?.includes('INVITE'));
    const hasBye = pasteMessages.some(m => m.method === 'BYE');
    const hasError4xx = pasteMessages.some(m => (m.code ?? 0) >= 400 && (m.code ?? 0) < 500);
    const hasError5xx = pasteMessages.some(m => (m.code ?? 0) >= 500);

    if (has200ForInvite && hasBye) {
      const byeTime = pasteMessages.find(m => m.method === 'BYE')?.timestamp;
      const inviteTime = pasteMessages.find(m => m.method === 'INVITE')?.timestamp;
      const ok200Time = pasteMessages.find(m => m.code === 200 && m.cseq?.includes('INVITE'))?.timestamp;
      const callDurMs = byeTime && ok200Time ? tsToMs(byeTime) - tsToMs(ok200Time) : null;
      if (callDurMs !== null && callDurMs < 5000) {
        findings.push({
          severity: 'warning',
          title: 'Very Short Connected Duration — Possible Early Disconnect',
          detail: `Call was answered (200 OK) but BYE was sent only ${callDurMs}ms later. This pattern often indicates Sippy sent a BYE immediately after answering due to a billing or routing failure detected post-answer (e.g. no rate found, credit exhausted, or ACL violation). The SIP trace shows success at signaling level but the CDR likely shows zero billable duration.`,
          fix: 'Look up the CDR for this Call-ID in the CDR Lookup tab to see the exact Sippy result code and prefix.',
        });
      }
    }

    if (hasError4xx) {
      const err = pasteMessages.find(m => (m.code ?? 0) >= 400 && (m.code ?? 0) < 500);
      findings.push({
        severity: 'critical',
        title: `SIP ${err?.code} — Client-Side Rejection`,
        detail: `A 4xx response was received. ${err?.code === 403 ? '403 Forbidden usually means authentication failure, ACL block, or account suspended.' : err?.code === 404 ? '404 Not Found means the destination number was unroutable.' : err?.code === 486 ? '486 Busy Here means the destination UA is busy.' : 'Check the specific code for details.'}`,
        fix: 'Review the SIP response reason phrase and the CDR result for the matching Call-ID.',
      });
    }

    if (hasError5xx) {
      findings.push({
        severity: 'critical',
        title: 'SIP 5xx — Server-Side Failure',
        detail: 'A 5xx response indicates a failure on the server or carrier side. This is not a caller or translation issue — it is an internal server error or gateway unavailability.',
        fix: 'Check Sippy gateway status, carrier connectivity, and server logs.',
      });
    }

    if (findings.length === 0) {
      findings.push({
        severity: 'info',
        title: 'No anomalies detected in this SIP trace',
        detail: 'The trace shows a normal call flow. Paste the trace and look up the Call-ID in CDR Lookup mode for detailed billing and result analysis.',
        fix: undefined,
      });
    }
  }

  if (findings.length === 0) return null;

  const colorMap = {
    critical: { border: 'border-red-500/25', bg: 'bg-red-500/5', dot: 'bg-red-500', title: 'text-red-300', badge: 'bg-red-500/15 text-red-400 border-red-500/25' },
    warning:  { border: 'border-amber-500/25', bg: 'bg-amber-500/5', dot: 'bg-amber-500', title: 'text-amber-300', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
    info:     { border: 'border-blue-500/20', bg: 'bg-blue-500/5', dot: 'bg-blue-400', title: 'text-blue-300', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  };

  const critical = findings.filter(f => f.severity === 'critical').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;

  return (
    <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
      <div className="flex items-center gap-3 mb-4">
        <ShieldAlert className="h-4 w-4 text-orange-400 shrink-0" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-orange-300">Diagnostic Analysis</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Auto-detected {findings.length} finding{findings.length !== 1 ? 's' : ''} from this call
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {critical > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25 font-medium">{critical} critical</span>}
          {warnings > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 font-medium">{warnings} warning</span>}
        </div>
      </div>

      <div className="space-y-3">
        {findings.map((f, i) => {
          const c = colorMap[f.severity];
          return (
            <div key={i} className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
              <div className="flex items-start gap-2.5 mb-1.5">
                <div className={`h-2 w-2 rounded-full ${c.dot} mt-1.5 shrink-0`} />
                <p className={`text-xs font-semibold ${c.title}`}>{f.title}</p>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed ml-4.5 pl-0.5">{f.detail}</p>
              {f.fix && (
                <div className="mt-2 ml-4.5 pl-0.5 flex items-start gap-1.5">
                  <Zap className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-emerald-400/80 leading-relaxed">{f.fix}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
              {/* Diagnostic Panel */}
              <DiagnosticPanel cdr={traceData.cdr} sipEvents={traceData.sipEvents} />

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
                    <Button
                      variant="outline" size="sm"
                      className="h-7 px-2 text-[11px] gap-1"
                      data-testid="button-download-trace-txt"
                      onClick={() => downloadBlob(
                        sipEventsToTxt(traceData.sipEvents, traceData.cdr),
                        `sip-trace-${traceData.cdr.callId?.slice(0,20) ?? 'export'}.txt`,
                        'text/plain'
                      )}>
                      <FileText className="h-3 w-3" /> TXT
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      className="h-7 px-2 text-[11px] gap-1"
                      data-testid="button-download-trace-csv"
                      onClick={() => downloadBlob(
                        sipEventsToCsv(traceData.sipEvents),
                        `sip-trace-${traceData.cdr.callId?.slice(0,20) ?? 'export'}.csv`,
                        'text/csv'
                      )}>
                      <FileSpreadsheet className="h-3 w-3" /> CSV
                    </Button>
                  </div>
                </div>
                <div className="bg-muted/5 rounded-lg border border-border/30 p-4 overflow-x-auto">
                  <SipLadder events={traceData.sipEvents} uaLabel={uaLabel} cdr={traceData.cdr} />
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-3 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Reconstructed from Sippy CDR timing fields (setup_time, connect_time, disconnect_time, pdd, pdd1xx).
                  Actual SIP headers require a raw packet capture (PCAP).
                </p>
              </div>

              {/* CDR Metadata */}
              <CdrMetaPanel cdr={traceData.cdr} />

              {/* SDP / Codec Negotiation */}
              <SdpPanel iCall={traceData.cdr.iCall} />
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
            <div className="flex flex-col gap-4">
              {/* Diagnostic analysis for paste mode */}
              <DiagnosticPanel pasteMessages={parsedPaste} />

              <div className="rounded-xl border border-border/50 bg-card/50 p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold">SIP Ladder</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{parsedPaste.length} messages</span>
                    <Button
                      variant="outline" size="sm"
                      className="h-7 px-2 text-[11px] gap-1"
                      data-testid="button-download-paste-txt"
                      onClick={() => {
                        const callId = parsedPaste.find(m => m.callId)?.callId;
                        downloadBlob(
                          sipMessagesToTxt(parsedPaste, callId),
                          `sip-trace-${callId?.slice(0,20) ?? 'export'}.txt`,
                          'text/plain'
                        );
                      }}>
                      <FileText className="h-3 w-3" /> TXT
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      className="h-7 px-2 text-[11px] gap-1"
                      data-testid="button-download-paste-csv"
                      onClick={() => {
                        const callId = parsedPaste.find(m => m.callId)?.callId;
                        downloadBlob(
                          sipMessagesToCsv(parsedPaste),
                          `sip-trace-${callId?.slice(0,20) ?? 'export'}.csv`,
                          'text/csv'
                        );
                      }}>
                      <FileSpreadsheet className="h-3 w-3" /> CSV
                    </Button>
                  </div>
                </div>
                <div className="bg-muted/5 rounded-lg border border-border/30 p-4">
                  <PasteLadder messages={parsedPaste} />
                </div>
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
