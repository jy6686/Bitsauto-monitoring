import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, AlertTriangle, CheckCircle2, TrendingDown, Zap, Search, RefreshCw, Info, ArrowRight, Brain, Lightbulb, Activity, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Anomaly {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  rootCause: string;
  affectedEntities: string[];
  recommendation: string;
  detectedAt: string;
  resolved: boolean;
}

interface Prediction {
  id: string;
  type: string;
  entity: string;
  description: string;
  estimatedTime: string;
  confidence: number;
}

const MOCK_ANOMALIES: Anomaly[] = [
  {
    id: 'a1', severity: 'high',
    title: 'ASR Drop — Pakistan Mobile Routes',
    description: 'ASR for Pakistan mobile (92) dropped from 78% to 31% in the last 18 minutes.',
    rootCause: 'Carrier Callntalk returning 503 Service Unavailable for 920xxx prefixes since 14:32 UTC. 3 other routes share this carrier.',
    affectedEntities: ['Callntalk', 'Route: PK-Mobile-Tier1', 'Destination Set: PAK-BULK'],
    recommendation: 'Deprioritise Callntalk for 92xxx and promote TALK as primary. Review Callntalk trunk registration status.',
    detectedAt: new Date(Date.now() - 18 * 60000).toISOString(),
    resolved: false,
  },
  {
    id: 'a2', severity: 'medium',
    title: 'Unusual Call Volume Spike',
    description: 'CPS jumped from 0.2 to 1.8 in the last 5 minutes — 9× above the 30-day baseline.',
    rootCause: 'Single source IP 45.59.163.182 is generating the excess traffic. Pattern consistent with campaign launch, not fraud.',
    affectedEntities: ['Account: PUSHTOTALK', 'IP: 45.59.163.182'],
    recommendation: 'Monitor for continued increase. If CPS exceeds 5, trigger concurrent call limit alert.',
    detectedAt: new Date(Date.now() - 5 * 60000).toISOString(),
    resolved: false,
  },
  {
    id: 'a3', severity: 'low',
    title: 'Vendor Balance Warning',
    description: 'TALK vendor balance at $0.00 — below the $10 minimum threshold.',
    rootCause: 'Balance depletion detected at routine snapshot. Traffic is currently routing around this vendor automatically.',
    affectedEntities: ['Vendor: TALK'],
    recommendation: 'Top up TALK vendor balance to restore routing capacity.',
    detectedAt: new Date(Date.now() - 45 * 60000).toISOString(),
    resolved: true,
  },
];

const MOCK_PREDICTIONS: Prediction[] = [
  { id: 'p1', type: 'capacity', entity: 'Callntalk', description: 'At current traffic growth, Callntalk will exhaust concurrent call limit', estimatedTime: '~35 minutes', confidence: 78 },
  { id: 'p2', type: 'quality',  entity: 'Route: PAK-MOBILE', description: 'MOS degradation trend suggests quality will drop below 3.5', estimatedTime: '~2 hours', confidence: 62 },
];

const SEVERITY_CONFIG = {
  critical: { color: 'text-rose-400',   bg: 'bg-rose-500/5 border-rose-500/30',     badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30'   },
  high:     { color: 'text-orange-400', bg: 'bg-orange-500/5 border-orange-500/30', badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  medium:   { color: 'text-amber-400',  bg: 'bg-amber-500/5 border-amber-500/30',   badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  low:      { color: 'text-blue-400',   bg: 'bg-blue-500/5 border-blue-500/20',     badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30'   },
};

const NLQ_EXAMPLES = [
  "Show me all failed calls to Pakistan in the last 2 hours",
  "Which carrier had the worst ASR today?",
  "How many calls did PUSHTOTALK make this week?",
  "What destinations saw the most FAS flags this month?",
];

export default function AiOpsPage() {
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);
  const [showOnlyActive, setShowOnlyActive] = useState(false);

  const anomalies = showOnlyActive ? MOCK_ANOMALIES.filter(a => !a.resolved) : MOCK_ANOMALIES;
  const activeCount = MOCK_ANOMALIES.filter(a => !a.resolved).length;
  const criticalCount = MOCK_ANOMALIES.filter(a => a.severity === 'critical' && !a.resolved).length;

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setQuerying(true);
    setQueryResult(null);
    await new Promise(r => setTimeout(r, 1200));
    setQueryResult(`Query: "${query}"\n\nAI analysis running against your Sippy CDR data…\n\nResult: This feature requires the AI Operations backend to be connected to your CDR data pipeline. Once configured, natural language queries are translated to SQL and executed against your CDR warehouse in real-time.\n\nExample output: "Found 847 failed calls to Pakistan (92xxx) in the last 2 hours. Top failure reason: 503 from Callntalk (61%), 408 Timeout (28%), 486 Busy (11%)."`);
    setQuerying(false);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <Bot className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">AI Operations Center</h1>
              <p className="text-sm text-muted-foreground">Anomaly detection, root-cause inference and natural language analytics</p>
            </div>
          </div>
          <Button size="sm" variant="outline" data-testid="button-refresh-aiops">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>

        {/* Status banner */}
        {activeCount > 0 && (
          <div className={cn("rounded-xl border p-4 flex items-center gap-3", criticalCount > 0 ? "bg-rose-500/5 border-rose-500/30" : "bg-amber-500/5 border-amber-500/30")}>
            <AlertTriangle className={cn("h-5 w-5 shrink-0", criticalCount > 0 ? "text-rose-400" : "text-amber-400")} />
            <div className="flex-1">
              <p className={cn("text-sm font-semibold", criticalCount > 0 ? "text-rose-300" : "text-amber-300")}>
                {activeCount} active anomal{activeCount === 1 ? 'y' : 'ies'} detected
              </p>
              <p className="text-xs text-muted-foreground">AI is monitoring your network in real-time and has identified issues requiring attention.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Anomaly feed */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-rose-400" /> Anomaly Feed
              </h2>
              <button
                onClick={() => setShowOnlyActive(s => !s)}
                className={cn("text-xs px-2 py-1 rounded-lg border transition-colors", showOnlyActive ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
              >
                Active only
              </button>
            </div>

            {anomalies.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No active anomalies — network looks healthy</p>
              </div>
            ) : (
              <div className="space-y-3">
                {anomalies.map(a => {
                  const cfg = SEVERITY_CONFIG[a.severity];
                  return (
                    <div key={a.id} className={cn("rounded-xl border p-5 space-y-3", a.resolved ? "opacity-60 bg-card border-border" : cfg.bg)}>
                      <div className="flex items-start gap-3">
                        <AlertTriangle className={cn("h-4 w-4 shrink-0 mt-0.5", a.resolved ? "text-muted-foreground" : cfg.color)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{a.title}</span>
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border", cfg.badge)}>
                              {a.severity.toUpperCase()}
                            </span>
                            {a.resolved && <span className="text-[10px] text-emerald-400 font-semibold">Resolved</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{a.description}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {Math.round((Date.now() - new Date(a.detectedAt).getTime()) / 60000)}m ago
                        </span>
                      </div>

                      <div className="rounded-lg bg-background/60 border border-border/50 p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Root Cause</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{a.rootCause}</p>
                      </div>

                      <div className="flex items-start gap-2">
                        <Lightbulb className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-300/80 leading-relaxed">{a.recommendation}</p>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {a.affectedEntities.map(e => (
                          <span key={e} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/30 border border-border text-muted-foreground font-mono">{e}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Predictions */}
            <h2 className="text-sm font-semibold flex items-center gap-2 pt-2">
              <Brain className="h-4 w-4 text-violet-400" /> Predictive Alerts
            </h2>
            <div className="space-y-2">
              {MOCK_PREDICTIONS.map(p => (
                <div key={p.id} className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
                  <div className="p-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 shrink-0">
                    <Brain className="h-3.5 w-3.5 text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{p.entity}</span>
                      <span className="text-[10px] text-muted-foreground/60">in {p.estimatedTime}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-violet-400">{p.confidence}%</p>
                    <p className="text-[10px] text-muted-foreground">confidence</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* NLQ panel */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Search className="h-4 w-4 text-cyan-400" /> Natural Language Query
            </h2>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <form onSubmit={handleQuery} className="space-y-2">
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Ask anything about your network…"
                  className="text-sm"
                  data-testid="input-ai-query"
                />
                <Button type="submit" disabled={!query.trim() || querying} className="w-full" size="sm" data-testid="button-ai-query">
                  {querying ? "Analysing…" : <><Zap className="h-3.5 w-3.5 mr-1.5" /> Ask AI</>}
                </Button>
              </form>

              {queryResult && (
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">{queryResult}</pre>
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Example queries</p>
                {NLQ_EXAMPLES.map(ex => (
                  <button
                    key={ex}
                    onClick={() => setQuery(ex)}
                    className="w-full text-left text-[11px] text-muted-foreground/70 hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/40 transition-colors leading-snug"
                  >
                    <ArrowRight className="h-2.5 w-2.5 inline mr-1.5 shrink-0" />{ex}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-muted-foreground">
                Anomaly detection uses statistical baselines from your last 30 days of CDR and quality data. 
                Natural language query requires connecting to your CDR data pipeline. 
                Both work automatically once sufficient historical data is accumulated.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
