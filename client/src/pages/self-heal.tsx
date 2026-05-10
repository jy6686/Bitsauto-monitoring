import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronRight,
  RefreshCw, Zap, ArrowRight, ShieldAlert, TrendingDown,
  TrendingUp, Minus, Info, XCircle, Shield, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CarrierHealth {
  carrierName:    string;
  stabilityScore: number | null;
  rollingAsr:     number | null;
  failureRate:    number | null;
  trend:          string | null;
  sampleCount:    number;
  status:         "healthy" | "degraded" | "critical";
}

interface Proposal {
  id:                  string;
  carrierName:         string;
  stabilityScore:      number | null;
  rollingAsr:          number | null;
  failureRate:         number | null;
  trend:               string | null;
  iRoutingGroup:       number;
  groupName:           string;
  iRoutingGroupMember: number;
  iConnection:         number;
  currentPreference:   number;
  currentWeight:       number;
  proposedPreference:  number;
  proposedWeight:      number;
  action:              "deprioritize" | "bypass";
  healthyAlternatives: string[];
  risk:                "high" | "low";
}

interface SelfHealStatus {
  carrierHealth:       CarrierHealth[];
  proposals:           Proposal[];
  routingGroupsChecked: number;
  lastCheckedAt:       string;
  warning?:            string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StabilityBar({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const color = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={cn("text-xs font-mono font-bold tabular-nums w-8 text-right",
        pct >= 75 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-rose-400"
      )}>{pct.toFixed(0)}</span>
    </div>
  );
}

function TrendIcon({ trend }: { trend: string | null }) {
  if (trend === "improving")  return <TrendingUp  className="h-3.5 w-3.5 text-emerald-400" />;
  if (trend === "degrading")  return <TrendingDown className="h-3.5 w-3.5 text-rose-400" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function statusBadge(status: string) {
  if (status === "critical") return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/25 text-[10px] h-4">Critical</Badge>;
  if (status === "degraded") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px] h-4">Degraded</Badge>;
  return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px] h-4">Healthy</Badge>;
}

// ── Carrier Health Card ───────────────────────────────────────────────────────

function CarrierCard({ c }: { c: CarrierHealth }) {
  const pulse = c.status === "critical";
  return (
    <div className={cn(
      "bg-card border rounded-xl p-4 space-y-3 transition-all",
      c.status === "critical" ? "border-rose-500/40 shadow-rose-500/10 shadow-sm"
        : c.status === "degraded" ? "border-amber-500/30"
        : "border-border",
    )} data-testid={`card-carrier-${c.carrierName}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {pulse && <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
          </span>}
          <span className="font-semibold text-sm truncate">{c.carrierName}</span>
        </div>
        {statusBadge(c.status)}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Stability</span>
          <div className="flex items-center gap-1"><TrendIcon trend={c.trend} /></div>
        </div>
        <StabilityBar score={c.stabilityScore} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-muted/30 rounded-lg p-2">
          <p className="text-muted-foreground">ASR</p>
          <p className={cn("font-mono font-bold mt-0.5",
            (c.rollingAsr ?? 0) >= 60 ? "text-emerald-400" : (c.rollingAsr ?? 0) >= 40 ? "text-amber-400" : "text-rose-400"
          )}>{c.rollingAsr != null ? `${c.rollingAsr.toFixed(1)}%` : "—"}</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-2">
          <p className="text-muted-foreground">Fail Rate</p>
          <p className={cn("font-mono font-bold mt-0.5",
            (c.failureRate ?? 0) <= 0.1 ? "text-emerald-400" : (c.failureRate ?? 0) <= 0.3 ? "text-amber-400" : "text-rose-400"
          )}>{c.failureRate != null ? `${(c.failureRate * 100).toFixed(1)}%` : "—"}</p>
        </div>
      </div>

      {c.sampleCount > 0 && (
        <p className="text-[10px] text-muted-foreground/60">{c.sampleCount.toLocaleString()} samples · 24h window</p>
      )}
    </div>
  );
}

// ── Proposal Card ─────────────────────────────────────────────────────────────

function ProposalCard({
  p, selected, onToggle,
}: {
  p: Proposal;
  selected: boolean;
  onToggle: () => void;
}) {
  const actionColor = p.action === "bypass" ? "text-rose-400" : "text-amber-400";
  const actionLabel = p.action === "bypass"
    ? "Bypass (send to last)"
    : "Deprioritize (lower weight)";

  return (
    <div
      className={cn(
        "bg-card border rounded-xl p-5 cursor-pointer transition-all",
        selected
          ? "border-primary/60 shadow-sm shadow-primary/10 ring-1 ring-primary/20"
          : "border-border hover:border-border/80",
      )}
      onClick={onToggle}
      data-testid={`proposal-${p.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            "flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
            selected ? "bg-primary border-primary" : "border-muted-foreground/40",
          )}>
            {selected && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{p.carrierName}</p>
            <p className="text-xs text-muted-foreground truncate">in {p.groupName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {p.risk === "high" && (
            <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/25 text-[10px] h-4 gap-1">
              <AlertTriangle className="h-2.5 w-2.5" />No failover
            </Badge>
          )}
          <Badge className={cn("text-[10px] h-4 capitalize",
            p.action === "bypass"
              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
          )}>{p.action}</Badge>
        </div>
      </div>

      {/* Stability indicator */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
          <span className="text-xs text-muted-foreground">Stability</span>
          <span className="text-xs font-mono font-bold text-rose-400">{(p.stabilityScore ?? 0).toFixed(0)}/100</span>
        </div>
        {p.rollingAsr != null && (
          <div className="text-xs text-muted-foreground">
            ASR <span className="font-mono font-bold text-foreground">{p.rollingAsr.toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* Before → After */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="bg-muted/20 border border-border/60 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground mb-2 font-medium uppercase tracking-wide">Current</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Preference</span>
              <span className="font-mono font-bold">{p.currentPreference}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Weight</span>
              <span className="font-mono font-bold">{p.currentWeight}</span>
            </div>
          </div>
        </div>

        <div className="relative bg-primary/5 border border-primary/20 rounded-lg p-3">
          <p className="text-[10px] text-primary/70 mb-2 font-medium uppercase tracking-wide">Proposed</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Preference</span>
              <span className={cn("font-mono font-bold", actionColor)}>{p.proposedPreference}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Weight</span>
              <span className={cn("font-mono font-bold", actionColor)}>{p.proposedWeight}</span>
            </div>
          </div>
          <ArrowRight className="absolute -left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* Failover info */}
      {p.healthyAlternatives.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-400">
          <Shield className="h-3 w-3" />
          <span>Failover: {p.healthyAlternatives.slice(0, 2).join(", ")}</span>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SelfHealPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [analysis, setAnalysis] = useState<SelfHealStatus | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Carrier health (lightweight, always loaded)
  const { data: scoresData, isLoading: scoresLoading } = useQuery<CarrierHealth[]>({
    queryKey: ["/api/carrier-scores"],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    staleTime: 60_000,
  });
  const scores: CarrierHealth[] = Array.isArray(scoresData) ? scoresData : [];

  // Recent rule_engine approval requests (for history)
  const { data: approvalsResp } = useQuery<{ requests: any[] }>({
    queryKey: ["/api/approvals"],
    staleTime: 30_000,
  });
  const ruleEngineRequests = (approvalsResp?.requests ?? []).filter(
    (r: any) => r.source === "rule_engine"
  ).slice(0, 5);

  // Stats
  const healthy  = scores.filter(s => (s.stabilityScore ?? 100) >= 75).length;
  const degraded = scores.filter(s => { const sc = s.stabilityScore ?? 100; return sc >= 50 && sc < 75; }).length;
  const critical = scores.filter(s => (s.stabilityScore ?? 100) < 50).length;

  // Submit proposals mutation
  const submitMut = useMutation({
    mutationFn: (proposals: Proposal[]) =>
      apiRequest("POST", "/api/routing/self-heal/propose", { proposals }).then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      toast({
        title: `${data.submitted} proposal${data.submitted === 1 ? "" : "s"} submitted`,
        description: "Pending approval in the Approval Queue.",
        action: (
          <button
            onClick={() => navigate("/approvals")}
            className="text-xs text-primary underline"
          >
            View Approvals →
          </button>
        ) as any,
      });
      setAnalysis(null);
      setSelected(new Set());
    },
    onError: () => toast({ title: "Failed to submit proposals", variant: "destructive" }),
  });

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const resp = await fetch("/api/routing/self-heal/status").then(r => r.json());
      setAnalysis(resp);
      setSelected(new Set((resp.proposals ?? []).map((p: Proposal) => p.id)));
    } catch {
      toast({ title: "Analysis failed", description: "Could not reach routing engine", variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleProposal(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const selectedProposals = (analysis?.proposals ?? []).filter(p => selected.has(p.id));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                <Zap className="h-5 w-5 text-violet-400" />
              </div>
              <h1 className="text-xl font-bold">Self-Healing Routing</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Detect degraded carriers and auto-rebalance route weights via the approval gate — with rollback protection on every change.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => navigate("/approvals")} data-testid="btn-view-approvals">
              <Clock className="h-4 w-4 mr-1.5" />
              View Approval Queue
              {ruleEngineRequests.length > 0 && (
                <Badge className="ml-1.5 h-4 px-1 bg-primary/20 text-primary border-primary/20 text-[10px]">
                  {ruleEngineRequests.length}
                </Badge>
              )}
            </Button>
            <Button
              size="sm"
              onClick={runAnalysis}
              disabled={analyzing}
              data-testid="btn-analyze"
              className="bg-violet-600 hover:bg-violet-500 text-white"
            >
              {analyzing
                ? <><RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />Analyzing…</>
                : <><Activity className="h-4 w-4 mr-1.5" />Analyze Routing</>
              }
            </Button>
          </div>
        </div>

        {/* ── Health summary bar ── */}
        {scores.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Healthy Carriers",  count: healthy,  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 },
              { label: "Degraded Carriers", count: degraded, color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",   icon: AlertTriangle },
              { label: "Critical Carriers", count: critical, color: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/20",     icon: XCircle },
            ].map(({ label, count, color, bg, icon: Icon }) => (
              <div key={label} className={cn("border rounded-xl p-4 flex items-center gap-3", bg)}>
                <Icon className={cn("h-5 w-5 flex-shrink-0", color)} />
                <div>
                  <p className={cn("text-2xl font-bold", color)}>{count}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Carrier Health Grid ── */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Carrier Health · 24h Window</h2>
          {scoresLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-4 h-36 animate-pulse" />
              ))}
            </div>
          ) : scores.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No carrier quality data yet. CDR samples are needed to compute scores.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {scores.map(c => <CarrierCard key={c.carrierName} c={c} />)}
            </div>
          )}
        </section>

        {/* ── Analysis Results ── */}
        {analysis && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Routing Analysis · {analysis.routingGroupsChecked} group{analysis.routingGroupsChecked === 1 ? "" : "s"} checked
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(analysis.lastCheckedAt).toLocaleTimeString()} ·{" "}
                  {analysis.proposals.length === 0
                    ? "No issues detected"
                    : `${analysis.proposals.length} issue${analysis.proposals.length === 1 ? "" : "s"} detected`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground text-xs"
                onClick={() => { setAnalysis(null); setSelected(new Set()); }}
              >
                Clear
              </Button>
            </div>

            {analysis.warning && (
              <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 mb-3 flex items-center gap-2 text-sm text-amber-400">
                <Info className="h-4 w-4 flex-shrink-0" />
                {analysis.warning}
              </div>
            )}

            {analysis.proposals.length === 0 ? (
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <p className="font-semibold text-emerald-400">All routes look healthy</p>
                <p className="text-sm text-muted-foreground mt-1">No routing adjustments are needed at this time.</p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {analysis.proposals.map(p => (
                    <ProposalCard
                      key={p.id}
                      p={p}
                      selected={selected.has(p.id)}
                      onToggle={() => toggleProposal(p.id)}
                    />
                  ))}
                </div>

                {/* Submit footer */}
                <div className="mt-4 bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {selectedProposals.length === 0
                        ? "Select proposals to submit"
                        : `${selectedProposals.length} proposal${selectedProposals.length === 1 ? "" : "s"} selected`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Changes require approval before being applied to Sippy. Rollback available after execution.
                    </p>
                  </div>
                  <Button
                    disabled={selectedProposals.length === 0 || submitMut.isPending}
                    onClick={() => submitMut.mutate(selectedProposals)}
                    data-testid="btn-submit-proposals"
                    className="bg-violet-600 hover:bg-violet-500 text-white flex-shrink-0"
                  >
                    {submitMut.isPending ? (
                      <><RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />Submitting…</>
                    ) : (
                      <><ChevronRight className="h-4 w-4 mr-1.5" />Submit for Approval</>
                    )}
                  </Button>
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Analyze CTA (when not yet analyzed) ── */}
        {!analysis && !analyzing && (
          <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center">
            <div className="p-3 rounded-full bg-violet-500/10 w-fit mx-auto mb-3">
              <Zap className="h-6 w-6 text-violet-400" />
            </div>
            <p className="font-semibold mb-1">Ready to analyze</p>
            <p className="text-sm text-muted-foreground mb-4">
              Click "Analyze Routing" to check routing groups against carrier health scores and generate rebalancing proposals.
            </p>
            <Button
              onClick={runAnalysis}
              className="bg-violet-600 hover:bg-violet-500 text-white"
              data-testid="btn-analyze-cta"
            >
              <Activity className="h-4 w-4 mr-1.5" />
              Analyze Routing Groups
            </Button>
          </div>
        )}

        {/* ── Recent auto-proposals history ── */}
        {ruleEngineRequests.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recent Auto-Proposals</h2>
            <div className="bg-card border border-border rounded-xl divide-y divide-border">
              {ruleEngineRequests.map((r: any) => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.entityName ?? r.operationType}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge className={cn("text-[10px] h-4",
                      r.status === "approved"  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" :
                      r.status === "rejected"  ? "bg-rose-500/15 text-rose-400 border-rose-500/25" :
                                                 "bg-amber-500/15 text-amber-400 border-amber-500/25"
                    )}>{r.status}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => navigate(`/approvals?id=${r.id}`)}
                    >
                      View <ChevronRight className="h-3 w-3 ml-0.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Safety disclaimer ── */}
        <div className="bg-muted/20 border border-border/50 rounded-xl p-4 flex items-start gap-3 text-xs text-muted-foreground">
          <Shield className="h-4 w-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">Approval Gate & Rollback Protection</p>
            <p>All route changes submitted by the self-healing engine require explicit approval before execution. Once approved and applied, every change records a before-state snapshot — allowing one-click rollback from the Approval Queue.</p>
          </div>
        </div>

      </div>
    </div>
  );
}
