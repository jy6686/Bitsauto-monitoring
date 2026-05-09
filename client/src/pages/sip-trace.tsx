import { useState, useRef } from "react";
import { GitBranch, Search, Upload, AlertTriangle, Info, ChevronDown, ChevronUp, Clock, ArrowRight, ArrowLeft, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SipMessage {
  seq: number;
  timestamp: string;
  from: string;
  to: string;
  method: string;
  code?: number;
  cseq?: string;
  callId?: string;
  raw: string;
}

const SAMPLE_TRACE = `2026-05-08 10:00:00.000 SIP/2.0 INVITE sip:+12633887383@191.101.30.107 SIP/2.0
Via: SIP/2.0/UDP 45.59.163.182:5060;branch=z9hG4bK-abc123
From: <sip:PUSHTOTALK@191.101.30.107>;tag=12345
To: <sip:+12633887383@191.101.30.107>
Call-ID: abc123@45.59.163.182
CSeq: 1 INVITE
Contact: <sip:PUSHTOTALK@45.59.163.182:5060>
Content-Type: application/sdp
Content-Length: 0

2026-05-08 10:00:00.015 SIP/2.0 100 Trying
Via: SIP/2.0/UDP 45.59.163.182:5060;branch=z9hG4bK-abc123
From: <sip:PUSHTOTALK@191.101.30.107>;tag=12345
To: <sip:+12633887383@191.101.30.107>
Call-ID: abc123@45.59.163.182
CSeq: 1 INVITE

2026-05-08 10:00:00.230 SIP/2.0 180 Ringing
Via: SIP/2.0/UDP 45.59.163.182:5060;branch=z9hG4bK-abc123
From: <sip:PUSHTOTALK@191.101.30.107>;tag=12345
To: <sip:+12633887383@191.101.30.107>;tag=67890
Call-ID: abc123@45.59.163.182
CSeq: 1 INVITE

2026-05-08 10:00:04.810 SIP/2.0 200 OK
Via: SIP/2.0/UDP 45.59.163.182:5060;branch=z9hG4bK-abc123
From: <sip:PUSHTOTALK@191.101.30.107>;tag=12345
To: <sip:+12633887383@191.101.30.107>;tag=67890
Call-ID: abc123@45.59.163.182
CSeq: 1 INVITE

2026-05-08 10:00:04.820 ACK sip:+12633887383@191.101.30.107 SIP/2.0
Via: SIP/2.0/UDP 45.59.163.182:5060;branch=z9hG4bK-def456
From: <sip:PUSHTOTALK@191.101.30.107>;tag=12345
To: <sip:+12633887383@191.101.30.107>;tag=67890
Call-ID: abc123@45.59.163.182
CSeq: 2 ACK

2026-05-08 10:00:35.100 BYE sip:+12633887383@191.101.30.107 SIP/2.0
Via: SIP/2.0/UDP 45.59.163.182:5060;branch=z9hG4bK-ghi789
From: <sip:PUSHTOTALK@191.101.30.107>;tag=12345
To: <sip:+12633887383@191.101.30.107>;tag=67890
Call-ID: abc123@45.59.163.182
CSeq: 3 BYE

2026-05-08 10:00:35.120 SIP/2.0 200 OK
Via: SIP/2.0/UDP 45.59.163.182:5060;branch=z9hG4bK-ghi789
From: <sip:PUSHTOTALK@191.101.30.107>;tag=12345
To: <sip:+12633887383@191.101.30.107>;tag=67890
Call-ID: abc123@45.59.163.182
CSeq: 3 BYE`;

function parseTimestamp(line: string): string {
  const m = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[.,]\d+)/);
  return m ? m[1].split(' ')[1] : '';
}

function parseSipMessages(raw: string): SipMessage[] {
  const blocks = raw.trim().split(/\n\s*\n/).filter(b => b.trim());
  const msgs: SipMessage[] = [];
  let seq = 0;

  for (const block of blocks) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const firstLine = lines[0];
    const timestamp = parseTimestamp(firstLine);
    const cleanFirst = firstLine.replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[.,]\d+\s*/, '');

    let method = '';
    let code: number | undefined;
    let direction: 'send' | 'recv' = 'send';

    const requestMatch = cleanFirst.match(/^(INVITE|ACK|BYE|CANCEL|OPTIONS|REGISTER|PRACK|UPDATE|REFER|NOTIFY|SUBSCRIBE|PUBLISH|MESSAGE|INFO)\s+/i);
    const responseMatch = cleanFirst.match(/^SIP\/2\.0\s+(\d{3})\s+(.*)/);

    if (requestMatch) {
      method = requestMatch[1].toUpperCase();
      direction = 'send';
    } else if (responseMatch) {
      code = parseInt(responseMatch[1]);
      const cseqLine = lines.find(l => l.toLowerCase().startsWith('cseq:'));
      if (cseqLine) {
        const parts = cseqLine.split(' ');
        method = parts[parts.length - 1].toUpperCase();
      } else {
        method = code < 200 ? 'PROVISIONAL' : code < 300 ? 'RESPONSE' : 'ERROR';
      }
      direction = 'recv';
    } else continue;

    const fromLine = lines.find(l => l.toLowerCase().startsWith('from:')) || '';
    const toLine = lines.find(l => l.toLowerCase().startsWith('to:')) || '';
    const callIdLine = lines.find(l => l.toLowerCase().startsWith('call-id:')) || '';
    const cseqLine = lines.find(l => l.toLowerCase().startsWith('cseq:')) || '';

    const extractAddr = (h: string) => {
      const m = h.match(/@([^;>\s]+)/);
      return m ? m[1] : h.split(':').slice(1).join(':').trim();
    };

    msgs.push({
      seq: ++seq,
      timestamp,
      from: direction === 'send' ? extractAddr(fromLine) : extractAddr(toLine),
      to: direction === 'send' ? extractAddr(toLine) : extractAddr(fromLine),
      method,
      code,
      cseq: cseqLine.split(':').slice(1).join(':').trim(),
      callId: callIdLine.split(':').slice(1).join(':').trim(),
      raw: block,
    });
  }
  return msgs;
}

function msgColor(method: string, code?: number): string {
  if (code !== undefined) {
    if (code >= 100 && code < 200) return 'text-blue-400 border-blue-400/40 bg-blue-500/5';
    if (code >= 200 && code < 300) return 'text-emerald-400 border-emerald-400/40 bg-emerald-500/5';
    if (code >= 400 && code < 500) return 'text-amber-400 border-amber-400/40 bg-amber-500/5';
    if (code >= 500) return 'text-rose-400 border-rose-400/40 bg-rose-500/5';
  }
  switch (method) {
    case 'INVITE':  return 'text-violet-400 border-violet-400/40 bg-violet-500/5';
    case 'BYE':     return 'text-rose-400 border-rose-400/40 bg-rose-500/5';
    case 'CANCEL':  return 'text-orange-400 border-orange-400/40 bg-orange-500/5';
    case 'ACK':     return 'text-cyan-400 border-cyan-400/40 bg-cyan-500/5';
    default:        return 'text-muted-foreground border-border bg-muted/20';
  }
}

function LadderDiagram({ messages }: { messages: SipMessage[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!messages.length) return (
    <div className="text-center py-12 text-muted-foreground text-sm">No SIP messages parsed yet.</div>
  );

  const endpoints = Array.from(new Set(messages.flatMap(m => [m.from, m.to])));
  const ua = endpoints[0] || 'UA';
  const proxy = endpoints[1] || 'Proxy';

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* Endpoint headers */}
        <div className="grid grid-cols-[140px_1fr_140px] gap-0 mb-2">
          <div className="text-center">
            <div className="inline-block px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/30 text-xs font-mono font-semibold text-violet-300 truncate max-w-full">{ua}</div>
          </div>
          <div />
          <div className="text-center">
            <div className="inline-block px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs font-mono font-semibold text-cyan-300 truncate max-w-full">{proxy}</div>
          </div>
        </div>

        {/* Vertical lines + messages */}
        <div className="relative">
          {messages.map((msg, i) => {
            const isLeft = i % 2 === 0;
            const color = msgColor(msg.method, msg.code);
            const label = msg.code ? `${msg.code} ${msg.method}` : msg.method;
            const isExp = expanded === msg.seq;
            return (
              <div key={msg.seq} className="mb-1">
                <div
                  className={cn("grid grid-cols-[140px_1fr_140px] gap-0 items-center cursor-pointer group", isExp && "mb-0")}
                  onClick={() => setExpanded(isExp ? null : msg.seq)}
                >
                  {/* Left timeline dot */}
                  <div className="flex items-center justify-end pr-2">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-muted-foreground/60 font-mono">{msg.timestamp?.slice(0, 12)}</span>
                    </div>
                    <div className={cn("h-3 w-3 rounded-full border-2 ml-2 flex-shrink-0", isLeft ? 'border-violet-400 bg-violet-500/30' : 'border-cyan-400/40 bg-transparent')} />
                  </div>

                  {/* Arrow + label */}
                  <div className="relative flex items-center px-2">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-border/30" />
                    <div className={cn(
                      "relative flex items-center w-full transition-all",
                      isLeft ? "flex-row" : "flex-row-reverse"
                    )}>
                      {isLeft ? <ArrowRight className={cn("h-3.5 w-3.5 flex-shrink-0 ml-auto", color.split(' ')[0])} /> : <ArrowLeft className={cn("h-3.5 w-3.5 flex-shrink-0 mr-auto", color.split(' ')[0])} />}
                      <span className={cn(
                        "mx-2 px-2 py-0.5 rounded border text-xs font-semibold font-mono whitespace-nowrap group-hover:opacity-90 transition-opacity",
                        color
                      )}>
                        {label}
                      </span>
                    </div>
                  </div>

                  {/* Right timeline dot */}
                  <div className="flex items-center pl-2">
                    <div className={cn("h-3 w-3 rounded-full border-2 flex-shrink-0", !isLeft ? 'border-violet-400 bg-violet-500/30' : 'border-cyan-400/40 bg-transparent')} />
                  </div>
                </div>

                {/* Expanded raw */}
                {isExp && (
                  <div className="mx-[160px] mt-1 mb-2 rounded-lg border border-border bg-muted/20 p-3">
                    <pre className="text-[11px] text-muted-foreground font-mono whitespace-pre-wrap break-all leading-relaxed">{msg.raw}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom endpoint labels */}
        <div className="grid grid-cols-[140px_1fr_140px] gap-0 mt-2">
          <div className="text-center">
            <div className="inline-block px-2 py-1 rounded bg-violet-500/5 text-[10px] font-mono text-violet-400/70">{ua}</div>
          </div>
          <div />
          <div className="text-center">
            <div className="inline-block px-2 py-1 rounded bg-cyan-500/5 text-[10px] font-mono text-cyan-400/70">{proxy}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SipTracePage() {
  const [traceText, setTraceText] = useState('');
  const [messages, setMessages] = useState<SipMessage[]>([]);
  const [parsed, setParsed] = useState(false);
  const [cdrId, setCdrId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleParse() {
    const msgs = parseSipMessages(traceText);
    setMessages(msgs);
    setParsed(true);
  }

  function handleLoadSample() {
    setTraceText(SAMPLE_TRACE);
    const msgs = parseSipMessages(SAMPLE_TRACE);
    setMessages(msgs);
    setParsed(true);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      setTraceText(text);
      const msgs = parseSipMessages(text);
      setMessages(msgs);
      setParsed(true);
    };
    reader.readAsText(file);
  }

  const callId = messages[0]?.callId || null;
  const duration = messages.length > 1
    ? (() => {
        const first = messages[0]?.timestamp;
        const last = messages[messages.length - 1]?.timestamp;
        return first && last ? `${first} → ${last}` : null;
      })()
    : null;

  const hasError = messages.some(m => m.code && m.code >= 400);
  const connected = messages.some(m => m.code === 200 && m.method === 'INVITE');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <GitBranch className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">SIP Trace Viewer</h1>
            <p className="text-sm text-muted-foreground">Parse SIP signalling logs into an interactive ladder diagram</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Input panel */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Upload className="h-4 w-4 text-muted-foreground" /> Input SIP Trace
              </h2>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground font-medium">Lookup by CDR / Call-ID</label>
                <div className="flex gap-2">
                  <Input value={cdrId} onChange={e => setCdrId(e.target.value)} placeholder="e.g. abc123@45.59.163.182" className="font-mono text-xs" data-testid="input-cdr-id" />
                  <Button size="sm" variant="outline" data-testid="button-lookup-cdr">
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">Sippy packet dumps are emailed — use manual paste below for immediate analysis.</p>
              </div>

              <div className="relative flex items-center gap-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">or paste trace</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="space-y-2">
                <Textarea
                  value={traceText}
                  onChange={e => setTraceText(e.target.value)}
                  placeholder="Paste raw SIP trace here..."
                  className="font-mono text-[11px] min-h-[260px] resize-none"
                  data-testid="textarea-sip-trace"
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={handleParse} disabled={!traceText.trim()} data-testid="button-parse-trace">
                  <GitBranch className="h-3.5 w-3.5 mr-1.5" /> Parse
                </Button>
                <Button size="sm" variant="outline" onClick={handleLoadSample} data-testid="button-load-sample">
                  Load Sample
                </Button>
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} data-testid="button-upload-pcap">
                  <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload
                </Button>
                <input ref={fileRef} type="file" accept=".txt,.log,.pcap,.sip" className="hidden" onChange={handleFile} />
              </div>
            </div>

            {/* Call summary */}
            {parsed && messages.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5 space-y-3">
                <h2 className="text-sm font-semibold">Call Summary</h2>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={cn("font-semibold", hasError ? "text-rose-400" : connected ? "text-emerald-400" : "text-amber-400")}>
                      {hasError ? "Failed" : connected ? "Connected" : "Incomplete"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Messages</span>
                    <span className="font-mono">{messages.length}</span>
                  </div>
                  {callId && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-muted-foreground shrink-0">Call-ID</span>
                      <span className="font-mono text-[10px] text-right truncate max-w-[180px]">{callId}</span>
                    </div>
                  )}
                  {duration && (
                    <div className="flex items-center gap-2 pt-1">
                      <Clock className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                      <span className="text-muted-foreground/70 font-mono">{duration}</span>
                    </div>
                  )}
                </div>

                <div className="pt-2 space-y-1">
                  <p className="text-[10px] text-muted-foreground/60 uppercase font-bold tracking-widest">Message Types</p>
                  {Array.from(new Set(messages.map(m => m.code ? `${m.code} ${m.method}` : m.method))).map(m => (
                    <div key={m} className="flex items-center justify-between text-xs">
                      <span className={cn("font-mono font-semibold px-1.5 py-0.5 rounded border text-[11px]", msgColor(m.split(' ')[1] || m, m.includes(' ') ? parseInt(m) : undefined))}>
                        {m}
                      </span>
                      <span className="text-muted-foreground">
                        {messages.filter(msg => (msg.code ? `${msg.code} ${msg.method}` : msg.method) === m).length}×
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Ladder diagram */}
          <div className="lg:col-span-3">
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-violet-400" /> Ladder Diagram
                </h2>
                {parsed && (
                  <span className="text-[10px] text-muted-foreground/60">Click any message to expand raw headers</span>
                )}
              </div>

              {!parsed ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                  <div className="p-4 rounded-2xl bg-violet-500/5 border border-violet-500/20">
                    <GitBranch className="h-10 w-10 text-violet-400/50" />
                  </div>
                  <p className="text-sm text-muted-foreground">Paste a SIP trace and click Parse</p>
                  <p className="text-xs text-muted-foreground/60">or load the sample to see the diagram</p>
                  <Button size="sm" variant="outline" onClick={handleLoadSample}>Load Sample Trace</Button>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                  <p className="text-sm text-amber-300">Could not parse SIP messages from the provided trace. Check the format and try again.</p>
                </div>
              ) : (
                <LadderDiagram messages={messages} />
              )}
            </div>

            {/* How-to */}
            {!parsed && (
              <div className="mt-4 bg-card border border-border rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground/80">Supported trace formats</p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li>Sippy packet dump logs (emailed via Admin → Tools → Packet Dump)</li>
                      <li>Wireshark SIP dissector exports (File → Export → Plain Text)</li>
                      <li>SIP stack debug logs (one message per blank-line-separated block)</li>
                      <li>Raw SIP captures with timestamps</li>
                    </ul>
                    <p className="pt-1">Each SIP message block should be separated by a blank line. The parser detects requests (INVITE, BYE, ACK…) and responses (100, 180, 200…) automatically.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
