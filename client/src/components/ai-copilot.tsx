import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Bot, Send, Sparkles, X, ChevronDown, ChevronUp,
  AlertTriangle, Activity, BarChart3, TrendingDown,
  CheckCircle2, Zap, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CarrierScore {
  carrierId: string;
  carrierName: string;
  stabilityScore: number | null;
  rollingAsr: number | null;
  avgPddMs: number | null;
  failureRate: number | null;
  trend: string | null;
  sampleCount: number;
}

interface AiOpsEvent {
  id: number;
  type: string;
  severity: string;
  message: string;
  entity: string | null;
  createdAt: string;
}

interface AiOpsIncident {
  id: number;
  title: string;
  severity: string;
  status: string;
  entityName: string | null;
  signalCount: number;
  narrative: string | null;
  createdAt: string;
}

interface RouteTrace {
  id: number;
  cld: string;
  selectedCarrier: string | null;
  decisionReason: string | null;
  outcome: string | null;
  sipCode: number | null;
  failureCategory: string | null;
  createdAt: string;
}

interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  data?: React.ReactNode;
  timestamp: Date;
}

// ── Query pattern engine ───────────────────────────────────────────────────────

function matchQuery(
  q: string,
  carriers: CarrierScore[],
  incidents: AiOpsIncident[],
  events: AiOpsEvent[],
  traces: RouteTrace[],
): { text: string; data?: React.ReactNode } {
  const lower = q.toLowerCase().trim();

  // ── "show degraded / critical carriers" ───────────────────────────────────
  if (/degraded|critical|bad.*carrier|low.*score|worst/i.test(lower)) {
    const scores24 = carriers.filter(c => c.carrierId.endsWith(":24h"));
    const degraded  = scores24.filter(c => (c.stabilityScore ?? 100) < 60).sort((a, b) => (a.stabilityScore ?? 0) - (b.stabilityScore ?? 0));
    if (degraded.length === 0) return { text: "No degraded carriers detected in the last 24 hours. All stability scores are above 60." };
    return {
      text: `Found ${degraded.length} carrier${degraded.length === 1 ? "" : "s"} with degraded quality scores in the last 24 hours:`,
      data: (
        <div className="mt-2 space-y-1.5">
          {degraded.map(c => (
            <div key={c.carrierId} className="flex items-center gap-2 p-2 rounded-lg bg-red-500/8 border border-red-500/15">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
              <span className="font-medium text-xs flex-1">{c.carrierName}</span>
              <span className="text-red-400 text-xs font-bold">{c.stabilityScore?.toFixed(0) ?? "?"}/100</span>
              <span className="text-muted-foreground text-[10px]">ASR {c.rollingAsr?.toFixed(1) ?? "?"}%</span>
            </div>
          ))}
        </div>
      ),
    };
  }

  // ── "why is [carrier] degraded / low" ────────────────────────────────────
  const carrierNameMatch = lower.match(/(?:why is|what.*wrong with|explain|check)\s+([a-z0-9\s]+?)(?:\s+(?:degraded|low|bad|failing|down|slow))?$/i);
  if (carrierNameMatch) {
    const name = carrierNameMatch[1].trim();
    const c = carriers.find(s => s.carrierName.toLowerCase().includes(name) && s.carrierId.endsWith(":24h"));
    if (c) {
      const issues: string[] = [];
      if ((c.stabilityScore ?? 100) < 60) issues.push(`stability score is low at ${c.stabilityScore?.toFixed(0)}/100`);
      if ((c.rollingAsr ?? 100) < 70) issues.push(`ASR is ${c.rollingAsr?.toFixed(1)}% (below 70% threshold)`);
      if ((c.failureRate ?? 0) > 20) issues.push(`failure rate is elevated at ${c.failureRate?.toFixed(1)}%`);
      if ((c.avgPddMs ?? 0) > 4000) issues.push(`average PDD is high at ${c.avgPddMs?.toFixed(0)}ms`);
      if (c.trend === "degrading") issues.push("trend is currently degrading vs previous window");
      const recentSignals = events.filter(e => e.entity?.toLowerCase().includes(c.carrierName.toLowerCase())).slice(0, 3);
      return {
        text: issues.length > 0
          ? `${c.carrierName} is showing ${issues.length} quality issue${issues.length > 1 ? "s" : ""}:\n• ${issues.join("\n• ")}`
          : `${c.carrierName} looks healthy. Stability: ${c.stabilityScore?.toFixed(0)}/100, ASR: ${c.rollingAsr?.toFixed(1)}%, trend: ${c.trend ?? "stable"}.`,
        data: recentSignals.length > 0 ? (
          <div className="mt-2 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Recent signals</p>
            {recentSignals.map(e => (
              <div key={e.id} className="text-[10px] text-muted-foreground p-1.5 rounded bg-muted/20">{e.message.slice(0, 120)}…</div>
            ))}
          </div>
        ) : undefined,
      };
    }
  }

  // ── "active incidents" / "what's happening" ───────────────────────────────
  if (/incident|what.*happen|what.*wrong|status|alert/i.test(lower)) {
    const active = incidents.filter(i => i.status === "active" || i.status === "open");
    if (active.length === 0) return { text: "No active incidents detected. All monitored systems are operating normally." };
    return {
      text: `There are ${active.length} active incident${active.length === 1 ? "" : "s"}:`,
      data: (
        <div className="mt-2 space-y-1.5">
          {active.slice(0, 5).map(inc => (
            <div key={inc.id} className={cn("p-2 rounded-lg border text-xs",
              inc.severity === "critical" ? "bg-red-500/8 border-red-500/20" : "bg-amber-500/8 border-amber-500/20")}>
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className={cn("h-3 w-3", inc.severity === "critical" ? "text-red-400" : "text-amber-400")} />
                <span className="font-semibold">{inc.title}</span>
                <span className="ml-auto text-muted-foreground text-[10px]">{inc.signalCount} signals</span>
              </div>
              {inc.narrative && <p className="text-muted-foreground text-[10px] leading-snug">{inc.narrative.slice(0, 150)}…</p>}
            </div>
          ))}
        </div>
      ),
    };
  }

  // ── "which routes changed today" / "recent decisions" ────────────────────
  if (/route.*changed|changed.*route|recent.*decision|decision.*today|today.*decision/i.test(lower)) {
    const recent = traces.slice(0, 8);
    if (recent.length === 0) return { text: "No route decision traces found. Run a synthetic test campaign to generate routing data." };
    const failed = recent.filter(t => t.outcome === "failed").length;
    return {
      text: `${recent.length} recent routing decisions found. ${failed} resulted in failures, ${recent.length - failed} connected successfully.`,
      data: (
        <div className="mt-2 space-y-1">
          {recent.map(t => (
            <div key={t.id} className="flex items-center gap-2 text-[10px] p-1.5 rounded bg-muted/20">
              <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", t.outcome === "connected" ? "bg-green-500" : "bg-red-500")} />
              <span className="font-mono">{t.cld}</span>
              <span className="text-muted-foreground flex-1 truncate">→ {t.selectedCarrier ?? "unknown"}</span>
              <span className="text-muted-foreground/60">{new Date(t.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
        </div>
      ),
    };
  }

  // ── "why was [carrier] selected" ─────────────────────────────────────────
  if (/why.*selected|reason.*select|select.*reason/i.test(lower)) {
    const nameMatch = lower.match(/why.*was\s+([a-z0-9\s]+?)\s+selected/i) || lower.match(/why\s+([a-z0-9\s]+?)\s+(?:was\s+)?selected/i);
    const name = nameMatch?.[1]?.trim() ?? "";
    const match = traces.find(t => t.selectedCarrier?.toLowerCase().includes(name));
    if (match) {
      return { text: `${match.selectedCarrier} was selected for ${match.cld}. Reason: ${match.decisionReason ?? "not recorded"}. Outcome: ${match.outcome ?? "unknown"} (SIP ${match.sipCode ?? "—"}).` };
    }
    const last = traces[0];
    if (last) {
      return { text: `Most recent carrier selection: ${last.selectedCarrier ?? "unknown"} for ${last.cld}. Decision reason: ${last.decisionReason ?? "not recorded"}.` };
    }
    return { text: "No route traces available yet. Run a synthetic test campaign to generate routing data." };
  }

  // ── "best carrier" / "top performing" ────────────────────────────────────
  if (/best|top.*perform|highest.*score|healthiest/i.test(lower)) {
    const scores24 = carriers.filter(c => c.carrierId.endsWith(":24h")).sort((a, b) => (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0));
    if (scores24.length === 0) return { text: "No carrier scores available yet." };
    const top = scores24[0];
    return {
      text: `The best performing carrier in the last 24h is ${top.carrierName} with a stability score of ${top.stabilityScore?.toFixed(0)}/100, ASR of ${top.rollingAsr?.toFixed(1)}%, and avg PDD of ${top.avgPddMs?.toFixed(0) ?? "—"}ms.`,
      data: (
        <div className="mt-2 space-y-1.5">
          {scores24.slice(0, 5).map((c, i) => (
            <div key={c.carrierId} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/20">
              <span className="text-muted-foreground/60 w-4">#{i + 1}</span>
              <span className="flex-1 font-medium">{c.carrierName}</span>
              <span className="font-bold text-green-400">{c.stabilityScore?.toFixed(0)}/100</span>
            </div>
          ))}
        </div>
      ),
    };
  }

  // ── "summary" / "overview" / "what's going on" ───────────────────────────
  if (/summary|overview|going on|status|how.*platform|platform.*status/i.test(lower)) {
    const scores24 = carriers.filter(c => c.carrierId.endsWith(":24h"));
    const healthy   = scores24.filter(c => (c.stabilityScore ?? 0) >= 70).length;
    const degradedC = scores24.filter(c => (c.stabilityScore ?? 100) < 60).length;
    const active    = incidents.filter(i => i.status === "active").length;
    return {
      text: `Platform summary: ${scores24.length} carriers monitored — ${healthy} healthy, ${degradedC} degraded. ${active > 0 ? `${active} active incident${active > 1 ? "s" : ""} requiring attention.` : "No active incidents."} ${traces.length} route decisions recorded.`,
    };
  }

  // ── "high pdd" / "slow carriers" / "latency" ─────────────────────────────
  if (/pdd|latency|slow|delay|ring/i.test(lower)) {
    const scores24 = carriers.filter(c => c.carrierId.endsWith(":24h") && c.avgPddMs != null).sort((a, b) => (b.avgPddMs ?? 0) - (a.avgPddMs ?? 0));
    if (scores24.length === 0) return { text: "No PDD data available yet." };
    return {
      text: `Carriers ranked by average PDD (highest first):`,
      data: (
        <div className="mt-2 space-y-1.5">
          {scores24.slice(0, 5).map(c => (
            <div key={c.carrierId} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/20">
              <Clock className={cn("h-3 w-3", (c.avgPddMs ?? 0) > 4000 ? "text-yellow-400" : "text-muted-foreground")} />
              <span className="flex-1">{c.carrierName}</span>
              <span className={cn("font-bold", (c.avgPddMs ?? 0) > 4000 ? "text-yellow-400" : "")}>{c.avgPddMs?.toFixed(0) ?? "—"}ms</span>
            </div>
          ))}
        </div>
      ),
    };
  }

  // ── Default: not understood ───────────────────────────────────────────────
  return {
    text: `I can help you with:\n• "Show degraded carriers"\n• "Why is [carrier] low?"\n• "Active incidents"\n• "Which routes changed today?"\n• "Best performing carrier"\n• "High PDD carriers"\n• "Platform summary"`,
  };
}

// ── Suggested prompts ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Show degraded carriers",
  "Active incidents",
  "Best performing carrier",
  "Which routes changed today?",
  "Platform summary",
  "High PDD carriers",
];

// ── Main component ─────────────────────────────────────────────────────────────

interface AiCopilotProps {
  open: boolean;
  onClose: () => void;
}

export function AiCopilot({ open, onClose }: AiCopilotProps) {
  const [messages, setMessages] = useState<CopilotMessage[]>([{
    id: "welcome",
    role: "assistant",
    text: "I'm your AI Copilot. Ask me anything about carrier health, incidents, route decisions, or platform status.",
    timestamp: new Date(),
  }]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: carriers = [] } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: incidents = [] } = useQuery<AiOpsIncident[]>({
    queryKey: ["/api/aiops/incidents"],
    staleTime: 30_000,
  });

  const { data: events = [] } = useQuery<AiOpsEvent[]>({
    queryKey: ["/api/aiops/events"],
    staleTime: 60_000,
  });

  const { data: traces = [] } = useQuery<RouteTrace[]>({
    queryKey: ["/api/route-traces"],
    queryFn: () => fetch("/api/route-traces?limit=50").then(r => r.json()),
    staleTime: 60_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(text: string) {
    if (!text.trim()) return;
    const userMsg: CopilotMessage = { id: `u-${Date.now()}`, role: "user", text, timestamp: new Date() };
    setMessages(m => [...m, userMsg]);
    setInput("");
    setThinking(true);

    await new Promise(r => setTimeout(r, 400 + Math.random() * 300));

    const result = matchQuery(text, carriers, incidents, events, traces);
    const botMsg: CopilotMessage = { id: `b-${Date.now()}`, role: "assistant", text: result.text, data: result.data, timestamp: new Date() };
    setMessages(m => [...m, botMsg]);
    setThinking(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 24, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 24, scale: 0.97 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-6 right-6 w-[360px] max-h-[600px] flex flex-col rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl z-[200]"
          data-testid="ai-copilot-panel"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 flex-shrink-0">
            <div className="bg-violet-500/20 p-1.5 rounded-lg">
              <Bot className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">AI Copilot</p>
              <p className="text-[10px] text-muted-foreground">NOC intelligence assistant</p>
            </div>
            <div className="flex-1" />
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-1.5 h-1.5 rounded-full bg-green-500"
            />
            <button onClick={onClose} className="p-1 rounded hover:bg-muted/50 transition-colors ml-1">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.map(msg => (
              <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed",
                  msg.role === "user"
                    ? "bg-violet-600 text-white rounded-br-sm"
                    : "bg-muted/60 text-foreground rounded-bl-sm"
                )}>
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                  {msg.data && <div className="mt-2">{msg.data}</div>}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="bg-muted/60 rounded-2xl rounded-bl-sm px-4 py-3">
                  <motion.div
                    className="flex gap-1"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  >
                    <span className="w-1.5 h-1.5 bg-violet-400 rounded-full" />
                    <span className="w-1.5 h-1.5 bg-violet-400 rounded-full" />
                    <span className="w-1.5 h-1.5 bg-violet-400 rounded-full" />
                  </motion.div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions */}
          {messages.length <= 1 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-violet-500/30 bg-violet-500/8 text-violet-400 hover:bg-violet-500/20 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-border/50 flex-shrink-0">
            <input
              data-testid="copilot-input"
              type="text"
              placeholder="Ask anything…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !thinking && handleSend(input)}
              className="flex-1 h-8 bg-muted/30 rounded-lg px-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            />
            <button
              data-testid="copilot-send"
              onClick={() => handleSend(input)}
              disabled={thinking || !input.trim()}
              className="p-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 transition-colors"
            >
              <Send className="h-3.5 w-3.5 text-white" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
