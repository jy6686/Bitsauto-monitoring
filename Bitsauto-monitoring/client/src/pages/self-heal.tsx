import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronRight,
  RefreshCw, Zap, ArrowRight, ShieldAlert, TrendingDown,
  TrendingUp, Minus, Info, XCircle, Shield, Clock,
  FlaskConical, Lock, Unlock, Play, RotateCcw, Plus,
  ChevronDown, List, FileText, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

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
  carrierHealth:        CarrierHealth[];
  proposals:            Proposal[];
  routingGroupsChecked: number;
  lastCheckedAt:        string;
  warning?:             string;
}

interface FailoverPolicy {
  id:                     number;
  label:                  string;
  routeGroupId:           string | null;
  destinationPrefix:      string | null;
  routeClass:             string;
  enabled:                boolean;
  minimumAsr:             number;
  maximumFas:             number;
  minimumStability:       number;
  maxTrafficShift:        number;
  maxDurationMinutes:     number;
  rollbackWindowMinutes:  number;
  notificationRequired:   boolean;
  approvedFailoverVendors: string[];
  simulationValidatedAt:  string | null;
  simulationScenario:     { fromCarrier: string; toCarrier: string; shiftPercent: number; delta: { asr: number; stability: number; fasRate: number; margin: number } } | null;
  armingStatus:           'disarmed' | 'armed' | 'active' | 'rolled_back';
  armedAt:                string | null;
  armedBy:                string | null;
  updatedAt:              string;
}

interface FailoverExecution {
  id:           number;
  policyId:     number;
  policyLabel:  string;
  status:       'active' | 'rolled_back' | 'completed' | 'failed';
  fromCarrier:  string;
  toCarrier:    string;
  shiftPercent: number;
  executedAt:   string;
  executedBy:   string;
  rollbackAt:   string | null;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  auditLog:     { ts: string; event: string; actor: string; detail?: string }[];
}

type SimResult = {
  valid: boolean; reason?: string;
  current:  { portfolioAsr: number; portfolioStability: number; portfolioFasRate: number; portfolioMargin: number };
  simulated:{ portfolioAsr: number; portfolioStability: number; portfolioFasRate: number; portfolioMargin: number };
  delta:    { asr: number; stability: number; fasRate: number; margin: number; concentration?: number };
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SIM_WARN_MS  = 25 * 60_000;
const SIM_STALE_MS = 30 * 60_000;

const ARMING_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  disarmed:    { label: 'Disarmed',    color: 'text-slate-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/20' },
  armed:       { label: 'Armed',       color: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/30'  },
  active:      { label: 'Executing',   color: 'text-orange-400',  bg: 'bg-orange-500/15',  border: 'border-orange-500/30'},
  rolled_back: { label: 'Rolled Back', color: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/30'},
};

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

function useSimFreshness(validatedAt: string | null) {
  const ageMs  = validatedAt ? Date.now() - new Date(validatedAt).getTime() : null;
  const fresh   = ageMs != null && ageMs < SIM_WARN_MS;
  const warning = ageMs != null && ageMs >= SIM_WARN_MS && ageMs < SIM_STALE_MS;
  const stale   = ageMs == null || ageMs >= SIM_STALE_MS;
  const minAgo  = ageMs != null ? Math.round(ageMs / 60_000) : null;
  const minLeft = ageMs != null ? Math.max(0, Math.round((SIM_STALE_MS - ageMs) / 60_000)) : null;
  return { fresh, warning, stale, minAgo, minLeft };
}

function RollbackCountdown({ rollbackAt }: { rollbackAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  const msLeft = new Date(rollbackAt).getTime() - now;
  if (msLeft <= 0) return <span className="text-xs text-rose-400 font-mono">Rollback overdue</span>;
  const m = Math.floor(msLeft / 60_000);
  const s = Math.floor((msLeft % 60_000) / 1000);
  const color = msLeft < 5 * 60_000 ? 'text-rose-400' : msLeft < 15 * 60_000 ? 'text-amber-400' : 'text-blue-400';
  return <span className={cn("text-xs font-mono font-semibold", color)}>Auto-rollback in {m}m {s}s</span>;
}

// ── Carrier Health Components ─────────────────────────────────────────────────

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

function ProposalCard({ p, selected, onToggle }: { p: Proposal; selected: boolean; onToggle: () => void }) {
  const actionColor = p.action === "bypass" ? "text-rose-400" : "text-amber-400";
  return (
    <div
      className={cn(
        "bg-card border rounded-xl p-5 cursor-pointer transition-all",
        selected ? "border-primary/60 shadow-sm shadow-primary/10 ring-1 ring-primary/20" : "border-border hover:border-border/80",
      )}
      onClick={onToggle}
      data-testid={`proposal-${p.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn("flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
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
            p.action === "bypass" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
          )}>{p.action}</Badge>
        </div>
      </div>
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
      {p.healthyAlternatives.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-400">
          <Shield className="h-3 w-3" />
          <span>Failover: {p.healthyAlternatives.slice(0, 2).join(", ")}</span>
        </div>
      )}
    </div>
  );
}

// ── Policy Simulation Panel ───────────────────────────────────────────────────

function PolicySimPanel({ policy, carrierNames, onValidated }: {
  policy: FailoverPolicy;
  carrierNames: string[];
  onValidated: (ts: string) => void;
}) {
  const toOptions = carrierNames.filter(c => c !== (policy.simulationScenario?.fromCarrier ?? ''));
  const [fromCarrier, setFromCarrier] = useState(policy.simulationScenario?.fromCarrier ?? carrierNames[0] ?? '');
  const [toCarrier, setToCarrier]     = useState(policy.simulationScenario?.toCarrier ?? toOptions[0] ?? '');
  const [shiftPct, setShiftPct]       = useState(policy.simulationScenario?.shiftPercent ?? Math.min(policy.maxTrafficShift, 15));
  const [simResult, setSimResult]     = useState<SimResult | null>(null);
  const [running, setRunning]         = useState(false);
  const [validating, setValidating]   = useState(false);
  const { toast } = useToast();

  async function runSim() {
    setRunning(true); setSimResult(null);
    try {
      const r = await apiRequest('POST', '/api/simulation', { fromCarrier, toCarrier, shiftPercent: shiftPct });
      setSimResult(await r.json());
    } catch (e: any) {
      toast({ title: 'Simulation failed', description: e.message ?? String(e), variant: 'destructive' });
    } finally { setRunning(false); }
  }

  async function confirmValidation() {
    if (!simResult) return;
    setValidating(true);
    try {
      const r = await apiRequest('POST', `/api/failover-policies/${policy.id}/simulate-validate`, { fromCarrier, toCarrier, shiftPercent: shiftPct });
      const d = await r.json();
      toast({ title: 'Simulation validated ✓', description: `Stamp recorded. Policy is now ready to arm.` });
      onValidated(d.simulationValidatedAt);
    } catch (e: any) {
      toast({ title: 'Validation failed', description: e.message ?? String(e), variant: 'destructive' });
    } finally { setValidating(false); }
  }

  const allFromOptions = carrierNames.length > 0 ? carrierNames : ['(no carrier data)'];
  const allToOptions   = carrierNames.filter(c => c !== fromCarrier);

  return (
    <div className="bg-blue-950/30 border border-blue-500/20 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-blue-400">
        <FlaskConical className="w-3.5 h-3.5" />
        Policy Simulation Sandbox
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-muted-foreground mb-1.5">From Carrier (degraded)</div>
          <select value={fromCarrier} onChange={e => { setFromCarrier(e.target.value); setSimResult(null); }}
            data-testid={`sim-from-${policy.id}`}
            className="w-full text-xs bg-muted/20 border border-border/30 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500/50">
            {allFromOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-1.5">To Carrier (failover target)</div>
          {allToOptions.length > 0 ? (
            <select value={toCarrier} onChange={e => { setToCarrier(e.target.value); setSimResult(null); }}
              data-testid={`sim-to-${policy.id}`}
              className="w-full text-xs bg-muted/20 border border-border/30 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500/50">
              {allToOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <div className="text-xs text-muted-foreground/50 px-3 py-2 bg-muted/10 border border-border/20 rounded-lg">No other carriers</div>
          )}
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[10px] text-muted-foreground mb-2">
          <span>Traffic shift</span>
          <span className="font-mono text-blue-400 font-semibold">{shiftPct}% <span className="text-muted-foreground/50">(max {policy.maxTrafficShift}%)</span></span>
        </div>
        <input type="range" min={1} max={policy.maxTrafficShift} value={shiftPct}
          data-testid={`sim-shift-${policy.id}`}
          onChange={e => { setShiftPct(Number(e.target.value)); setSimResult(null); }}
          className="w-full accent-blue-500" />
      </div>
      <button onClick={runSim} disabled={running || !fromCarrier || !toCarrier}
        data-testid={`btn-run-sim-policy-${policy.id}`}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25 text-xs font-medium transition-colors disabled:opacity-50">
        {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        {running ? 'Running simulation…' : 'Run Simulation'}
      </button>
      {simResult && (
        <div className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Portfolio Impact</div>
          <table className="w-full text-xs">
            <thead><tr>
              <th className="text-left text-muted-foreground/60 font-normal pb-2 pr-2">Metric</th>
              <th className="text-right text-muted-foreground/60 font-normal pb-2 pr-2">Current</th>
              <th className="text-right text-muted-foreground/60 font-normal pb-2 pr-2">Simulated</th>
              <th className="text-right text-muted-foreground/60 font-normal pb-2">Delta</th>
            </tr></thead>
            <tbody className="divide-y divide-border/20">
              {([
                { label: 'ASR',       cur: simResult.current.portfolioAsr,       sim: simResult.simulated.portfolioAsr,       d: simResult.delta.asr,       unit: '%', inv: false },
                { label: 'Stability', cur: simResult.current.portfolioStability,  sim: simResult.simulated.portfolioStability,  d: simResult.delta.stability,  unit: '',  inv: false },
                { label: 'FAS Rate',  cur: simResult.current.portfolioFasRate,    sim: simResult.simulated.portfolioFasRate,    d: simResult.delta.fasRate,    unit: '%', inv: true  },
                { label: 'Margin',    cur: simResult.current.portfolioMargin,     sim: simResult.simulated.portfolioMargin,     d: simResult.delta.margin,     unit: '',  inv: false },
              ] as { label: string; cur: number; sim: number; d: number; unit: string; inv: boolean }[]).map(row => {
                const isGood = row.inv ? row.d < 0 : row.d > 0;
                const dc = Math.abs(row.d) < 0.05 ? 'text-slate-400' : isGood ? 'text-emerald-400' : 'text-red-400';
                return <tr key={row.label}>
                  <td className="py-1.5 pr-2 text-muted-foreground">{row.label}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{row.cur.toFixed(1)}{row.unit}</td>
                  <td className="py-1.5 pr-2 text-right font-mono text-foreground">{row.sim.toFixed(1)}{row.unit}</td>
                  <td className={`py-1.5 text-right font-mono font-semibold ${dc}`}>{row.d > 0 ? '+' : ''}{row.d.toFixed(1)}{row.unit}</td>
                </tr>;
              })}
            </tbody>
          </table>
          {!simResult.valid && (
            <div className="flex items-start gap-2 text-xs text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{simResult.reason ?? 'Simulation has warnings — review before arming.'}</span>
            </div>
          )}
          <button onClick={confirmValidation} disabled={validating}
            data-testid={`btn-confirm-sim-policy-${policy.id}`}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium transition-colors disabled:opacity-50">
            {validating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {validating ? 'Recording validation…' : 'Confirm Simulation'}
          </button>
          <p className="text-[10px] text-muted-foreground/40">
            Records this simulation as the pre-arming validation stamp. Arming and execution are separate decisions.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Execute Inline Form ───────────────────────────────────────────────────────

function ExecuteForm({ policy, carrierNames, onExecuted, onCancel }: {
  policy: FailoverPolicy;
  carrierNames: string[];
  onExecuted: () => void;
  onCancel: () => void;
}) {
  const defaultFrom = policy.simulationScenario?.fromCarrier ?? carrierNames[0] ?? '';
  const defaultTo   = policy.approvedFailoverVendors[0] ?? policy.simulationScenario?.toCarrier ?? carrierNames.find(c => c !== defaultFrom) ?? '';
  const [fromCarrier, setFrom]   = useState(defaultFrom);
  const [toCarrier, setTo]       = useState(defaultTo);
  const [shiftPct, setShift]     = useState(policy.simulationScenario?.shiftPercent ?? Math.min(policy.maxTrafficShift, 15));
  const [reason, setReason]      = useState('');
  const { toast } = useToast();

  const execMut = useMutation({
    mutationFn: () => apiRequest('POST', `/api/failover-policies/${policy.id}/execute`, { fromCarrier, toCarrier, shiftPercent: shiftPct, reason }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/failover-policies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/failover-executions'] });
      toast({ title: 'Failover execution started', description: `${fromCarrier} → ${toCarrier} at ${shiftPct}%. Rollback scheduled in ${policy.maxDurationMinutes}m.` });
      onExecuted();
    },
    onError: (e: any) => toast({ title: 'Execution failed', description: e.message ?? String(e), variant: 'destructive' }),
  });

  const toOptions = policy.approvedFailoverVendors.length > 0
    ? policy.approvedFailoverVendors
    : carrierNames.filter(c => c !== fromCarrier);

  return (
    <div className="bg-orange-950/30 border border-orange-500/25 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-orange-400">
        <Zap className="w-3.5 h-3.5" />
        Execute Failover — {policy.label}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-muted-foreground mb-1.5">From Carrier</div>
          <select value={fromCarrier} onChange={e => setFrom(e.target.value)}
            data-testid={`exec-from-${policy.id}`}
            className="w-full text-xs bg-muted/20 border border-border/30 rounded-lg px-3 py-2 text-foreground focus:outline-none">
            {carrierNames.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-1.5">To Carrier {policy.approvedFailoverVendors.length > 0 && <span className="text-[10px] text-blue-400/70">(whitelisted)</span>}</div>
          {toOptions.length > 0 ? (
            <select value={toCarrier} onChange={e => setTo(e.target.value)}
              data-testid={`exec-to-${policy.id}`}
              className="w-full text-xs bg-muted/20 border border-border/30 rounded-lg px-3 py-2 text-foreground focus:outline-none">
              {toOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input value={toCarrier} onChange={e => setTo(e.target.value)} placeholder="Carrier name"
              className="w-full text-xs bg-muted/20 border border-border/30 rounded-lg px-3 py-2 text-foreground focus:outline-none" />
          )}
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[10px] text-muted-foreground mb-2">
          <span>Traffic shift</span>
          <span className="font-mono text-orange-400 font-semibold">{shiftPct}% <span className="text-muted-foreground/50">(max {policy.maxTrafficShift}%)</span></span>
        </div>
        <input type="range" min={1} max={policy.maxTrafficShift} value={shiftPct}
          onChange={e => setShift(Number(e.target.value))}
          className="w-full accent-orange-500" />
      </div>
      <div>
        <div className="text-[10px] text-muted-foreground mb-1.5">Reason <span className="text-muted-foreground/50">(optional)</span></div>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this failover being executed?"
          className="w-full text-xs bg-muted/20 border border-border/30 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-orange-500/40" />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
        <span>Auto-rollback in</span>
        <span className="font-mono font-semibold text-orange-400">{policy.maxDurationMinutes} minutes</span>
      </div>
      <div className="flex gap-2">
        <button onClick={() => execMut.mutate()} disabled={execMut.isPending || !fromCarrier || !toCarrier}
          data-testid={`btn-execute-confirm-${policy.id}`}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-orange-500/20 border border-orange-500/40 text-orange-400 hover:bg-orange-500/30 text-xs font-semibold transition-colors disabled:opacity-50">
          {execMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          {execMut.isPending ? 'Executing…' : 'Execute Failover'}
        </button>
        <button onClick={onCancel} className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-muted-foreground hover:text-foreground text-xs font-medium transition-colors">
          Cancel
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground/40">
        Advisory only — execution creates an audit record and rollback timer. No routing change is applied automatically; this records the operator decision.
      </p>
    </div>
  );
}

// ── Policy Card ───────────────────────────────────────────────────────────────

function PolicyCard({ policy, carrierNames, canArm, canExecute, canDisarm, onRefresh }: {
  policy: FailoverPolicy;
  carrierNames: string[];
  canArm: boolean;
  canExecute: boolean;
  canDisarm: boolean;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded]         = useState(false);
  const [showSimPanel, setShowSimPanel] = useState(false);
  const [showExecForm, setShowExecForm] = useState(false);
  const [localSimAt, setLocalSimAt]     = useState<string | null>(null);
  const { toast } = useToast();

  const simValidatedAt = localSimAt ?? policy.simulationValidatedAt;
  const { fresh: simFresh, warning: simWarning, stale: simStale, minAgo, minLeft } = useSimFreshness(simValidatedAt);

  const armMut = useMutation({
    mutationFn: () => apiRequest('POST', `/api/failover-policies/${policy.id}/arm`).then(r => r.json()),
    onSuccess: () => { toast({ title: 'Policy armed', description: `${policy.label} is now armed and ready to execute.` }); onRefresh(); },
    onError: (e: any) => toast({ title: 'Arming failed', description: e.message ?? String(e), variant: 'destructive' }),
  });

  const disarmMut = useMutation({
    mutationFn: () => apiRequest('POST', `/api/failover-policies/${policy.id}/disarm`).then(r => r.json()),
    onSuccess: () => { toast({ title: 'Policy disarmed' }); onRefresh(); },
    onError: (e: any) => toast({ title: 'Disarm failed', description: e.message ?? String(e), variant: 'destructive' }),
  });

  const am = ARMING_META[policy.armingStatus] ?? ARMING_META.disarmed;

  return (
    <div data-testid={`policy-card-${policy.id}`}
      className={cn("rounded-xl border bg-card overflow-hidden transition-all", am.border)}>
      {/* Header */}
      <div className="flex items-center gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm truncate">{policy.label}</span>
            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full border", am.color, am.bg, am.border)}>
              {am.label}
            </span>
            {policy.routeClass && (
              <span className="text-[10px] text-muted-foreground/60 font-mono">{policy.routeClass}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span>Min ASR <span className="font-mono text-foreground">{policy.minimumAsr}%</span></span>
            <span>Max FAS <span className="font-mono text-foreground">{policy.maximumFas}%</span></span>
            <span>Min Stability <span className="font-mono text-foreground">{policy.minimumStability}</span></span>
            <span>Max Shift <span className="font-mono text-foreground">{policy.maxTrafficShift}%</span></span>
            <span>Duration <span className="font-mono text-foreground">{policy.maxDurationMinutes}m</span></span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Simulation freshness */}
          {simFresh && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              Sim {minAgo === 0 ? 'just now' : `${minAgo}m ago`}
            </span>
          )}
          {simWarning && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400">
              <Clock className="w-3 h-3" />
              Stale in ~{minLeft}m
            </span>
          )}
          <button onClick={() => setExpanded(p => !p)} data-testid={`btn-expand-policy-${policy.id}`}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-border/20 px-4 pb-4 pt-3 space-y-4">
          {/* Vendor whitelist */}
          {policy.approvedFailoverVendors.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Approved Failover Vendors</div>
              <div className="flex flex-wrap gap-1.5">
                {policy.approvedFailoverVendors.map(v => (
                  <span key={v} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-mono">{v}</span>
                ))}
              </div>
            </div>
          )}

          {/* Simulation gate status */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Simulation Validation</div>
            {simStale && !simValidatedAt && (
              <p className="text-xs text-muted-foreground/60">No simulation validation recorded yet.</p>
            )}
            {simStale && simValidatedAt && (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 mb-2">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                Simulation expired — re-validate before arming
              </div>
            )}

            <button onClick={() => { setShowSimPanel(p => !p); setShowExecForm(false); }}
              data-testid={`btn-simulate-policy-${policy.id}`}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                showSimPanel ? "bg-blue-500/20 border-blue-500/40 text-blue-300" : "bg-blue-500/10 border-blue-500/25 text-blue-400 hover:bg-blue-500/20"
              )}>
              <FlaskConical className="w-3.5 h-3.5" />
              {showSimPanel ? 'Hide Simulation' : simFresh ? 'Re-Simulate' : 'Simulate to Validate'}
            </button>

            {showSimPanel && (
              <div className="mt-3">
                <PolicySimPanel policy={policy} carrierNames={carrierNames} onValidated={ts => {
                  setLocalSimAt(ts);
                  setShowSimPanel(false);
                }} />
              </div>
            )}
          </div>

          {/* Arm / Disarm / Execute */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Policy Actions</div>
            <div className="flex gap-2 flex-wrap">
              {policy.armingStatus === 'disarmed' && canArm && (
                <button onClick={() => armMut.mutate()} disabled={armMut.isPending}
                  data-testid={`btn-arm-${policy.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25 text-xs font-semibold transition-colors disabled:opacity-50">
                  {armMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                  Arm Policy
                </button>
              )}
              {(policy.armingStatus === 'armed') && canExecute && (
                <button onClick={() => { setShowExecForm(p => !p); setShowSimPanel(false); }}
                  data-testid={`btn-execute-${policy.id}`}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border",
                    showExecForm ? "bg-orange-500/25 border-orange-500/50 text-orange-300" : "bg-orange-500/15 border-orange-500/30 text-orange-400 hover:bg-orange-500/25"
                  )}>
                  <Zap className="w-3.5 h-3.5" />
                  {showExecForm ? 'Cancel Execute' : 'Execute Failover'}
                </button>
              )}
              {(policy.armingStatus === 'armed' || policy.armingStatus === 'active') && canDisarm && (
                <button onClick={() => disarmMut.mutate()} disabled={disarmMut.isPending}
                  data-testid={`btn-disarm-${policy.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30 text-muted-foreground hover:text-foreground text-xs font-medium transition-colors disabled:opacity-50">
                  {disarmMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                  Disarm
                </button>
              )}
              {policy.armingStatus === 'disarmed' && !canArm && (
                <span className="text-xs text-muted-foreground/50 italic flex items-center gap-1.5">
                  <Shield className="w-3 h-3" />
                  Routing Admin role required to arm
                </span>
              )}
            </div>

            {showExecForm && (
              <div className="mt-3">
                <ExecuteForm policy={policy} carrierNames={carrierNames}
                  onExecuted={() => setShowExecForm(false)}
                  onCancel={() => setShowExecForm(false)} />
              </div>
            )}
          </div>

          {/* Armed by info */}
          {policy.armedAt && (
            <p className="text-[10px] text-muted-foreground/50">
              Armed at {new Date(policy.armedAt).toLocaleString()}{policy.armedBy ? ` · by ${policy.armedBy}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── New Policy Form ───────────────────────────────────────────────────────────

function NewPolicyForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [label, setLabel]                   = useState('');
  const [minimumAsr, setMinAsr]             = useState(38);
  const [maximumFas, setMaxFas]             = useState(5);
  const [minimumStability, setMinStab]      = useState(55);
  const [maxTrafficShift, setMaxShift]      = useState(20);
  const [maxDurationMinutes, setMaxDur]     = useState(30);
  const [rollbackWindowMinutes, setRollback]= useState(30);
  const [vendorInput, setVendorInput]       = useState('');
  const [vendors, setVendors]               = useState<string[]>([]);
  const { toast } = useToast();

  const createMut = useMutation({
    mutationFn: () => apiRequest('POST', '/api/failover-policies', {
      label, minimumAsr, maximumFas, minimumStability, maxTrafficShift,
      maxDurationMinutes, rollbackWindowMinutes, approvedFailoverVendors: vendors,
      notificationRequired: true, enabled: false,
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/failover-policies'] });
      toast({ title: 'Policy created', description: label });
      onCreated();
    },
    onError: (e: any) => toast({ title: 'Create failed', description: e.message ?? String(e), variant: 'destructive' }),
  });

  function addVendor() {
    const v = vendorInput.trim();
    if (v && !vendors.includes(v)) { setVendors(p => [...p, v]); setVendorInput(''); }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="text-sm font-semibold">New Failover Policy</div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-widest block mb-1.5">Label *</label>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. EMEA Critical Failover"
          data-testid="input-policy-label"
          className="w-full text-sm bg-muted/20 border border-border/50 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary/50" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Min ASR %',     val: minimumAsr,    set: setMinAsr,   min: 0, max: 100 },
          { label: 'Max FAS %',     val: maximumFas,    set: setMaxFas,   min: 0, max: 50  },
          { label: 'Min Stability', val: minimumStability, set: setMinStab, min: 0, max: 100 },
        ].map(f => (
          <div key={f.label}>
            <label className="text-[10px] text-muted-foreground uppercase tracking-widest block mb-1.5">{f.label}</label>
            <input type="number" value={f.val} min={f.min} max={f.max}
              onChange={e => f.set(Number(e.target.value))}
              className="w-full text-sm bg-muted/20 border border-border/50 rounded-lg px-3 py-2 text-foreground focus:outline-none" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Max Shift %',   val: maxTrafficShift,      set: setMaxShift,  min: 1,  max: 50 },
          { label: 'Duration (min)',val: maxDurationMinutes,    set: setMaxDur,    min: 5,  max: 240 },
          { label: 'Rollback (min)',val: rollbackWindowMinutes, set: setRollback,  min: 5,  max: 240 },
        ].map(f => (
          <div key={f.label}>
            <label className="text-[10px] text-muted-foreground uppercase tracking-widest block mb-1.5">{f.label}</label>
            <input type="number" value={f.val} min={f.min} max={f.max}
              onChange={e => f.set(Number(e.target.value))}
              className="w-full text-sm bg-muted/20 border border-border/50 rounded-lg px-3 py-2 text-foreground focus:outline-none" />
          </div>
        ))}
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-widest block mb-1.5">Approved Failover Vendors</label>
        <div className="flex gap-2 mb-2">
          <input value={vendorInput} onChange={e => setVendorInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addVendor()}
            placeholder="Type carrier name + Enter"
            data-testid="input-vendor"
            className="flex-1 text-sm bg-muted/20 border border-border/50 rounded-lg px-3 py-2 text-foreground focus:outline-none" />
          <button onClick={addVendor} className="px-3 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 text-xs font-medium hover:bg-blue-500/25 transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {vendors.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {vendors.map(v => (
              <button key={v} onClick={() => setVendors(p => p.filter(x => x !== v))}
                className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-rose-500/20 hover:text-rose-400 hover:border-rose-500/30 transition-colors">
                {v} <XCircle className="w-2.5 h-2.5" />
              </button>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">Leave empty to allow any carrier. When set, execution is restricted to these vendors only.</p>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={() => createMut.mutate()} disabled={!label || createMut.isPending}
          data-testid="btn-create-policy"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-semibold transition-colors disabled:opacity-50">
          {createMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Create Policy
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-muted/20 border border-border/30 text-muted-foreground hover:text-foreground text-xs font-medium transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Execution Card ────────────────────────────────────────────────────────────

function ExecutionCard({ ex, canRollback, onRollback }: {
  ex: FailoverExecution;
  canRollback: boolean;
  onRollback: (id: number) => void;
}) {
  const [showAudit, setShowAudit] = useState(false);
  const STATUS_META: Record<string, { color: string; bg: string; border: string; label: string }> = {
    active:      { color: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/30', label: 'Active' },
    rolled_back: { color: 'text-violet-400', bg: 'bg-violet-500/15', border: 'border-violet-500/30', label: 'Rolled Back' },
    completed:   { color: 'text-emerald-400',bg: 'bg-emerald-500/15',border: 'border-emerald-500/30',label: 'Completed' },
    failed:      { color: 'text-rose-400',   bg: 'bg-rose-500/15',   border: 'border-rose-500/30',   label: 'Failed' },
  };
  const sm = STATUS_META[ex.status] ?? STATUS_META.active;

  return (
    <div data-testid={`exec-card-${ex.id}`} className={cn("rounded-xl border bg-card overflow-hidden", sm.border)}>
      <div className="flex items-center gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm">{ex.policyLabel}</span>
            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full border", sm.color, sm.bg, sm.border)}>{sm.label}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{ex.fromCarrier}</span>
            <ArrowRight className="w-3 h-3 shrink-0" />
            <span className="font-mono">{ex.toCarrier}</span>
            <span className={cn("font-mono font-semibold", sm.color)}>{ex.shiftPercent}% shift</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/60">
            <span>By {ex.executedBy}</span>
            <span>·</span>
            <span>{new Date(ex.executedAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {ex.status === 'active' && ex.rollbackAt && (
            <RollbackCountdown rollbackAt={ex.rollbackAt} />
          )}
          {ex.rolledBackAt && (
            <span className="text-[10px] text-muted-foreground/50">
              Rolled back {new Date(ex.rolledBackAt).toLocaleString()}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {ex.status === 'active' && canRollback && (
              <button onClick={() => onRollback(ex.id)}
                data-testid={`btn-rollback-${ex.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-400 hover:bg-violet-500/25 text-xs font-semibold transition-colors">
                <RotateCcw className="w-3.5 h-3.5" />
                Rollback Now
              </button>
            )}
            {ex.auditLog.length > 0 && (
              <button onClick={() => setShowAudit(p => !p)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <FileText className="w-3 h-3" />
                {showAudit ? 'Hide' : 'Audit'}
              </button>
            )}
          </div>
        </div>
      </div>
      {showAudit && ex.auditLog.length > 0 && (
        <div className="border-t border-border/20 px-4 pb-3 pt-2 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Audit Log</div>
          {ex.auditLog.map((entry, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-muted-foreground/40 font-mono text-[10px] shrink-0 pt-0.5">
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
              <div>
                <span className="font-medium text-foreground/80">{entry.event.replace(/_/g, ' ')}</span>
                {entry.detail && <span className="text-muted-foreground/60"> · {entry.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SelfHealPage() {
  const [, navigate]    = useLocation();
  const { toast }       = useToast();
  const { user }        = useAuth();
  const [tab, setTab]   = useState<'health' | 'policies' | 'executions'>('health');

  // Role awareness
  const roles: string[] = (user as any)?.roles ?? (user as any)?.role ? [(user as any).role] : [];
  const isRoutingAdmin = roles.some(r => ['routing_admin', 'admin', 'management', 'super_admin'].includes(r));
  const isDestMgr      = roles.some(r => ['destination_manager', 'routing_admin', 'admin', 'management', 'super_admin'].includes(r));

  // ── Health Tab Data ──────────────────────────────────────────────────────────
  const [analysis, setAnalysis]     = useState<SelfHealStatus | null>(null);
  const [analyzing, setAnalyzing]   = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());

  const { data: scoresData, isLoading: scoresLoading } = useQuery<CarrierHealth[]>({
    queryKey: ["/api/carrier-scores"],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    staleTime: 60_000,
  });
  const scores: CarrierHealth[] = Array.isArray(scoresData) ? scoresData : [];
  const carrierNames = scores.map(s => s.carrierName);

  const { data: approvalsResp } = useQuery<{ requests: any[] }>({
    queryKey: ["/api/approvals"], staleTime: 30_000,
  });
  const ruleEngineRequests = (approvalsResp?.requests ?? []).filter((r: any) => r.source === "rule_engine").slice(0, 5);

  const healthy  = scores.filter(s => (s.stabilityScore ?? 100) >= 75).length;
  const degraded = scores.filter(s => { const sc = s.stabilityScore ?? 100; return sc >= 50 && sc < 75; }).length;
  const critical = scores.filter(s => (s.stabilityScore ?? 100) < 50).length;

  const submitMut = useMutation({
    mutationFn: (proposals: Proposal[]) => apiRequest("POST", "/api/routing/self-heal/propose", { proposals }).then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      toast({
        title: `${data.submitted} proposal${data.submitted === 1 ? "" : "s"} submitted`,
        description: "Pending approval in the Approval Queue.",
        action: (<button onClick={() => navigate("/approvals")} className="text-xs text-primary underline">View Approvals →</button>) as any,
      });
      setAnalysis(null); setSelected(new Set());
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
    } finally { setAnalyzing(false); }
  }

  const selectedProposals = (analysis?.proposals ?? []).filter(p => selected.has(p.id));

  // ── Policies Tab Data ────────────────────────────────────────────────────────
  const [showNewPolicy, setShowNewPolicy] = useState(false);
  const { data: policiesData, refetch: refetchPolicies } = useQuery<FailoverPolicy[]>({
    queryKey: ['/api/failover-policies'],
    enabled: tab === 'policies',
    refetchOnWindowFocus: true,
  });
  const policies = policiesData ?? [];

  // ── Executions Tab Data ──────────────────────────────────────────────────────
  const { data: executionsData, refetch: refetchExec } = useQuery<FailoverExecution[]>({
    queryKey: ['/api/failover-executions'],
    enabled: tab === 'executions',
    refetchInterval: tab === 'executions' ? 30_000 : false,
  });
  const executions = executionsData ?? [];

  const rollbackMut = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/failover-executions/${id}/rollback`, { reason: 'Manual rollback' }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/failover-executions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/failover-policies'] });
      toast({ title: 'Rollback initiated', description: 'Execution has been rolled back. Policy returned to armed state.' });
    },
    onError: (e: any) => toast({ title: 'Rollback failed', description: e.message ?? String(e), variant: 'destructive' }),
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  const TABS = [
    { key: 'health',     label: 'Carrier Health',    icon: Activity },
    { key: 'policies',   label: 'Failover Policies', icon: Settings, badge: policies.filter(p => p.armingStatus === 'armed' || p.armingStatus === 'active').length || undefined },
    { key: 'executions', label: 'Execution Log',     icon: List,     badge: executions.filter(e => e.status === 'active').length || undefined },
  ] as const;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                <Zap className="h-5 w-5 text-violet-400" />
              </div>
              <h1 className="text-xl font-bold">Failover Engine</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Policy-governed carrier failover · Simulation-gated arming · Mandatory rollback · Advisory architecture
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => navigate("/approvals")} data-testid="btn-view-approvals">
              <Clock className="h-4 w-4 mr-1.5" />
              Approval Queue
              {ruleEngineRequests.length > 0 && (
                <Badge className="ml-1.5 h-4 px-1 bg-primary/20 text-primary border-primary/20 text-[10px]">{ruleEngineRequests.length}</Badge>
              )}
            </Button>
          </div>
        </div>

        {/* KPI strip — always visible */}
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

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-border/40">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
                data-testid={`tab-${t.key}`}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                  active ? "border-violet-500 text-violet-400" : "border-transparent text-muted-foreground hover:text-foreground"
                )}>
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {t.badge ? (
                  <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-semibold">{t.badge}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* ── Tab: Carrier Health ── */}
        {tab === 'health' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Carrier Health · 24h Window</h2>
              <Button size="sm" onClick={runAnalysis} disabled={analyzing}
                data-testid="btn-analyze"
                className="bg-violet-600 hover:bg-violet-500 text-white">
                {analyzing ? <><RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />Analyzing…</> : <><Activity className="h-4 w-4 mr-1.5" />Analyze Routing</>}
              </Button>
            </div>

            {scoresLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => <div key={i} className="bg-card border border-border rounded-xl p-4 h-36 animate-pulse" />)}
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

            {analysis && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Routing Analysis · {analysis.routingGroupsChecked} group{analysis.routingGroupsChecked === 1 ? "" : "s"} checked
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(analysis.lastCheckedAt).toLocaleTimeString()} · {analysis.proposals.length === 0 ? "No issues detected" : `${analysis.proposals.length} issue${analysis.proposals.length === 1 ? "" : "s"} detected`}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-muted-foreground text-xs" onClick={() => { setAnalysis(null); setSelected(new Set()); }}>Clear</Button>
                </div>
                {analysis.warning && (
                  <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 mb-3 flex items-center gap-2 text-sm text-amber-400">
                    <Info className="h-4 w-4 flex-shrink-0" />{analysis.warning}
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
                        <ProposalCard key={p.id} p={p} selected={selected.has(p.id)} onToggle={() => {
                          setSelected(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; });
                        }} />
                      ))}
                    </div>
                    <div className="mt-4 bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{selectedProposals.length === 0 ? "Select proposals to submit" : `${selectedProposals.length} proposal${selectedProposals.length === 1 ? "" : "s"} selected`}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Changes require approval before being applied to Sippy. Rollback available after execution.</p>
                      </div>
                      <Button disabled={selectedProposals.length === 0 || submitMut.isPending} onClick={() => submitMut.mutate(selectedProposals)}
                        data-testid="btn-submit-proposals"
                        className="bg-violet-600 hover:bg-violet-500 text-white flex-shrink-0">
                        {submitMut.isPending ? <><RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />Submitting…</> : <><ChevronRight className="h-4 w-4 mr-1.5" />Submit for Approval</>}
                      </Button>
                    </div>
                  </>
                )}
              </section>
            )}

            {!analysis && !analyzing && (
              <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center">
                <div className="p-3 rounded-full bg-violet-500/10 w-fit mx-auto mb-3">
                  <Zap className="h-6 w-6 text-violet-400" />
                </div>
                <p className="font-semibold mb-1">Ready to analyze</p>
                <p className="text-sm text-muted-foreground mb-4">Click "Analyze Routing" to check routing groups against carrier health scores and generate rebalancing proposals.</p>
                <Button onClick={runAnalysis} className="bg-violet-600 hover:bg-violet-500 text-white" data-testid="btn-analyze-cta">
                  <Activity className="h-4 w-4 mr-1.5" />Analyze Routing Groups
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Failover Policies ── */}
        {tab === 'policies' && (
          <div className="space-y-4">
            {/* Feature flag advisory banner */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-violet-950/40 border border-violet-500/20">
              <Shield className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
              <div className="text-xs text-violet-300/80 space-y-0.5">
                <p><span className="font-semibold text-violet-300">Policy-Governed Failover.</span> Policies must be simulated, armed by a Routing Admin, and executed explicitly. No automatic routing changes occur.</p>
                <p className="text-violet-400/60">When the <span className="font-mono">intelligent_failover</span> flag is OFF, arming is blocked. When <span className="font-mono">failover_simulation_required</span> is ON, a fresh simulation stamp is mandatory before arming.</p>
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Failover Policies <span className="text-muted-foreground/50 font-normal">({policies.length})</span>
              </h2>
              {isDestMgr && (
                <button onClick={() => setShowNewPolicy(p => !p)}
                  data-testid="btn-new-policy"
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                    showNewPolicy ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20"
                  )}>
                  <Plus className="w-3.5 h-3.5" />
                  {showNewPolicy ? 'Cancel' : 'New Policy'}
                </button>
              )}
            </div>

            {showNewPolicy && (
              <NewPolicyForm onCreated={() => setShowNewPolicy(false)} onCancel={() => setShowNewPolicy(false)} />
            )}

            {policies.length === 0 ? (
              <div className="bg-card border border-dashed border-border rounded-xl p-10 text-center space-y-3">
                <Settings className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">No failover policies yet.</p>
                {isDestMgr && <p className="text-xs text-muted-foreground/60">Click "New Policy" to create your first policy. Policies define thresholds, approved vendors, shift limits, and rollback windows.</p>}
              </div>
            ) : (
              <div className="space-y-3">
                {policies.map(p => (
                  <PolicyCard key={p.id} policy={p} carrierNames={carrierNames}
                    canArm={isRoutingAdmin}
                    canExecute={isRoutingAdmin}
                    canDisarm={isDestMgr || isRoutingAdmin}
                    onRefresh={() => refetchPolicies()} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Execution Log ── */}
        {tab === 'executions' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Execution Log <span className="text-muted-foreground/50 font-normal">({executions.length})</span>
              </h2>
              <button onClick={() => refetchExec()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>

            {executions.filter(e => e.status === 'active').length > 0 && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-orange-950/40 border border-orange-500/25">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
                </span>
                <p className="text-xs text-orange-300/80">
                  <span className="font-semibold text-orange-300">{executions.filter(e => e.status === 'active').length} active execution{executions.filter(e => e.status === 'active').length > 1 ? 's' : ''}.</span>{' '}
                  Rollback timers are counting down. Use "Rollback Now" to immediately revert.
                </p>
              </div>
            )}

            {executions.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-10 text-center space-y-2">
                <List className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">No failover executions yet.</p>
                <p className="text-xs text-muted-foreground/60">Executions are recorded here when a Routing Admin executes an armed policy.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {executions.map(ex => (
                  <ExecutionCard key={ex.id} ex={ex}
                    canRollback={isRoutingAdmin}
                    onRollback={id => rollbackMut.mutate(id)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Safety footer */}
        <div className="bg-muted/20 border border-border/50 rounded-xl p-4 flex items-start gap-3 text-xs text-muted-foreground">
          <Shield className="h-4 w-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">Governance Architecture</p>
            <p>Recommend → Simulate → Validate → Arm → Execute → Monitor → Rollback. No step is skipped. No routing change occurs without explicit Routing Admin action. Every execution is audit-stamped and time-bounded.</p>
          </div>
        </div>

      </div>
    </div>
  );
}
