import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  FlaskConical, ArrowRight, RefreshCw, Play, Shield, Info,
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2,
  BarChart3, Activity, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────

type CarrierInfo = {
  carrier: string; stabilityScore: number; rollingAsr: number;
  avgPddMs: number; failureRate: number; sampleCount: number;
};

type RouteOptData = {
  recommendations: CarrierInfo[];
};

type PortfolioMetrics = {
  portfolioAsr: number; portfolioStability: number;
  portfolioFasRate: number; portfolioMargin: number;
  vendorConcentration: number; projectedRevenue: number;
};

type CarrierSimState = {
  carrierName: string; trafficShare: number;
  asr: number; stability: number; fasRate: number;
};

type SimResult = {
  valid: boolean; reason?: string;
  current: PortfolioMetrics; simulated: PortfolioMetrics;
  delta: { asr: number; stability: number; fasRate: number; margin: number; concentration: number };
  carrierStates: { current: CarrierSimState[]; simulated: CarrierSimState[] };
};

// ── Delta chip ────────────────────────────────────────────────────────────────

function DeltaChip({ value, invert = false, unit = '' }: { value: number; invert?: boolean; unit?: string }) {
  const good    = invert ? value < 0 : value > 0;
  const neutral = Math.abs(value) < 0.1;
  const color   = neutral ? 'text-slate-400 bg-slate-500/10 border-slate-500/20'
                : good    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          : 'text-red-400 bg-red-500/10 border-red-500/20';
  const arrow   = neutral ? '' : value > 0 ? '↑ ' : '↓ ';
  return (
    <span className={`text-xs font-semibold font-mono px-1.5 py-0.5 rounded border ${color}`}>
      {arrow}{Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}{unit}
    </span>
  );
}

// ── Metric comparison row ─────────────────────────────────────────────────────

function MetricRow({
  label, current, simulated, delta, unit = '', invert = false, icon: Icon,
}: {
  label: string; current: number; simulated: number; delta: number;
  unit?: string; invert?: boolean; icon?: typeof Activity;
}) {
  const improved = invert ? delta < 0 : delta > 0;
  const neutral  = Math.abs(delta) < 0.1;
  const simColor = neutral ? 'text-foreground' : improved ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-4 items-center py-3 border-b border-border/20 last:border-0">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="text-sm font-mono text-center">{current.toFixed(1)}{unit}</div>
      <div className={`text-sm font-mono font-semibold text-center ${simColor}`}>{simulated.toFixed(1)}{unit}</div>
      <div className="flex justify-end">
        <DeltaChip value={delta} invert={invert} unit={unit} />
      </div>
    </div>
  );
}

// ── Carrier traffic bar ───────────────────────────────────────────────────────

function CarrierBar({ name, current, simulated }: { name: string; current: number; simulated: number }) {
  const diff = simulated - current;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-foreground/80 truncate max-w-[60%]">{name}</span>
        <span className="text-muted-foreground font-mono">
          {current.toFixed(0)}% → <span className={diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-orange-400' : 'text-foreground'}>{simulated.toFixed(0)}%</span>
        </span>
      </div>
      <div className="flex gap-0.5 h-2">
        <div className="bg-slate-500/40 rounded-l-full rounded-r-sm flex-shrink-0"
          style={{ width: `${Math.max(current, 0.5)}%` }} />
        {diff > 0 && <div className="bg-emerald-500/60 rounded-r-full flex-shrink-0" style={{ width: `${diff}%` }} />}
        {diff < 0 && <div className="bg-red-500/30 rounded-r-full flex-shrink-0" style={{ width: `${Math.abs(diff)}%` }} />}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SimulationSandboxPage() {
  const { toast } = useToast();

  const [fromCarrier, setFrom]    = useState('');
  const [toCarrier, setTo]        = useState('');
  const [shiftPercent, setShift]  = useState(10);
  const [result, setResult]       = useState<SimResult | null>(null);

  // Load carrier list from route-optimisation endpoint (reuse existing data)
  const { data: optData, isLoading: carriersLoading } = useQuery<RouteOptData>({
    queryKey: ['/api/route-optimisation'],
  });

  const carriers = optData?.recommendations ?? [];
  const carrierNames = carriers.map(c => c.carrier).sort();

  const simulateMut = useMutation({
    mutationFn: (body: { fromCarrier: string; toCarrier: string; shiftPercent: number }) =>
      apiRequest('POST', '/api/simulation', body),
    onSuccess: (data: any) => {
      setResult(data);
      if (!data.valid) toast({ title: 'Simulation invalid', description: data.reason, variant: 'destructive' });
    },
    onError: () => toast({ title: 'Simulation failed', variant: 'destructive' }),
  });

  const canSimulate = fromCarrier && toCarrier && fromCarrier !== toCarrier && shiftPercent > 0;

  const handleSimulate = () => {
    if (!canSimulate) return;
    simulateMut.mutate({ fromCarrier, toCarrier, shiftPercent });
  };

  // Find matching states for display
  const fromState    = result?.carrierStates.current.find(c => c.carrierName === fromCarrier);
  const fromSimState = result?.carrierStates.simulated.find(c => c.carrierName === fromCarrier);
  const toState      = result?.carrierStates.current.find(c => c.carrierName === toCarrier);
  const toSimState   = result?.carrierStates.simulated.find(c => c.carrierName === toCarrier);

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-card/40 shrink-0">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5 text-cyan-400" />
          <div>
            <h1 className="text-base font-semibold">Route Simulation Sandbox</h1>
            <p className="text-xs text-muted-foreground">Model traffic shifts — pure computation, zero production impact</p>
          </div>
        </div>
      </div>

      {/* Pure computation banner */}
      <div className="flex items-center gap-2.5 px-6 py-2.5 bg-cyan-950/30 border-b border-cyan-500/20 shrink-0">
        <Shield className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <p className="text-xs text-cyan-300/80">
          <span className="font-semibold text-cyan-300">Simulation only.</span>{" "}
          This is a decision laboratory. No routing changes, no database writes, no Sippy calls. All projections are computed in-memory from carrier quality data.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">

          {/* Input panel */}
          <div className="bg-card/50 border border-border/40 rounded-xl p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Configure scenario</div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">

              {/* From carrier */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Shift traffic away from</label>
                {carriersLoading ? (
                  <div className="h-9 bg-muted/30 rounded-lg animate-pulse" />
                ) : (
                  <select
                    data-testid="select-from-carrier"
                    value={fromCarrier}
                    onChange={e => { setFrom(e.target.value); setResult(null); }}
                    className="w-full h-9 px-3 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                  >
                    <option value="">Select carrier…</option>
                    {carrierNames.filter(n => n !== toCarrier).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Shift percent */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  Traffic shift: <span className="font-mono font-semibold text-cyan-400">{shiftPercent}%</span>
                </label>
                <div className="space-y-1">
                  <input
                    data-testid="slider-shift-percent"
                    type="range" min={1} max={50} step={1}
                    value={shiftPercent}
                    onChange={e => { setShift(Number(e.target.value)); setResult(null); }}
                    className="w-full accent-cyan-500"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground/50">
                    <span>1%</span><span>25%</span><span>50%</span>
                  </div>
                </div>
              </div>

              {/* To carrier */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Redirect to</label>
                {carriersLoading ? (
                  <div className="h-9 bg-muted/30 rounded-lg animate-pulse" />
                ) : (
                  <select
                    data-testid="select-to-carrier"
                    value={toCarrier}
                    onChange={e => { setTo(e.target.value); setResult(null); }}
                    className="w-full h-9 px-3 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                  >
                    <option value="">Select carrier…</option>
                    {carrierNames.filter(n => n !== fromCarrier).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Scenario summary */}
            {fromCarrier && toCarrier && (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground bg-muted/20 border border-border/30 rounded-lg px-4 py-2.5">
                <span className="font-medium text-foreground">{fromCarrier}</span>
                <ArrowRight className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="font-medium text-foreground">{toCarrier}</span>
                <span className="ml-2 text-muted-foreground">· shift <span className="font-mono text-cyan-400">{shiftPercent}%</span> of traffic</span>
              </div>
            )}

            <button
              data-testid="btn-run-simulation"
              onClick={handleSimulate}
              disabled={!canSimulate || simulateMut.isPending}
              className={cn(
                "mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                canSimulate
                  ? "bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25"
                  : "bg-muted/20 border border-border/30 text-muted-foreground cursor-not-allowed opacity-50"
              )}
            >
              {simulateMut.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" />Computing…</>
                : <><Play className="w-4 h-4" />Run Simulation</>
              }
            </button>
          </div>

          {/* Results */}
          {result && (
            <>
              {!result.valid ? (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="text-sm">{result.reason}</span>
                </div>
              ) : (
                <>
                  {/* Portfolio comparison */}
                  <div className="bg-card/50 border border-border/40 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-border/30">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Portfolio impact — current vs simulated</div>
                    </div>

                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-4 px-5 py-2 bg-muted/10 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                      <span>Metric</span>
                      <span className="text-center">Current</span>
                      <span className="text-center">Simulated</span>
                      <span className="text-right">Change</span>
                    </div>

                    <div className="px-5">
                      <MetricRow label="Portfolio ASR"       icon={Activity}    current={result.current.portfolioAsr}        simulated={result.simulated.portfolioAsr}        delta={result.delta.asr}           unit="%" />
                      <MetricRow label="Stability score"     icon={BarChart3}   current={result.current.portfolioStability}  simulated={result.simulated.portfolioStability}  delta={result.delta.stability} />
                      <MetricRow label="FAS rate"            icon={AlertTriangle} current={result.current.portfolioFasRate * 100} simulated={result.simulated.portfolioFasRate * 100} delta={result.delta.fasRate * 100} unit="%" invert />
                      <MetricRow label="Margin proxy"        icon={Zap}         current={result.current.portfolioMargin}     simulated={result.simulated.portfolioMargin}     delta={result.delta.margin} />
                      <MetricRow label="Vendor concentration" icon={BarChart3}  current={result.current.vendorConcentration} simulated={result.simulated.vendorConcentration} delta={result.delta.concentration} invert />
                    </div>
                  </div>

                  {/* Carrier traffic shift */}
                  <div className="bg-card/50 border border-border/40 rounded-xl p-5">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Traffic redistribution</div>
                    <div className="space-y-3">
                      {result.carrierStates.current
                        .filter(c => c.trafficShare > 0 || (result.carrierStates.simulated.find(s => s.carrierName === c.carrierName)?.trafficShare ?? 0) > 0)
                        .sort((a, b) => b.trafficShare - a.trafficShare)
                        .slice(0, 12)
                        .map(c => {
                          const sim = result.carrierStates.simulated.find(s => s.carrierName === c.carrierName);
                          return (
                            <CarrierBar
                              key={c.carrierName}
                              name={c.carrierName}
                              current={c.trafficShare}
                              simulated={sim?.trafficShare ?? c.trafficShare}
                            />
                          );
                        })}
                    </div>
                  </div>

                  {/* Carrier-level comparison for selected pair */}
                  {fromState && toState && fromSimState && toSimState && (
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { label: fromCarrier, curr: fromState, sim: fromSimState, role: 'reducing' },
                        { label: toCarrier,   curr: toState,   sim: toSimState,   role: 'absorbing' },
                      ].map(({ label, curr, sim, role }) => (
                        <div key={label} className="bg-card/50 border border-border/40 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-sm font-semibold truncate">{label}</div>
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full border",
                              role === 'reducing'
                                ? 'text-orange-400 bg-orange-500/10 border-orange-500/20'
                                : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                            )}>
                              {role === 'reducing' ? '↓ reducing' : '↑ absorbing'}
                            </span>
                          </div>
                          {[
                            { k: 'Traffic share', c: curr.trafficShare, s: sim.trafficShare, u: '%' },
                            { k: 'ASR',           c: curr.asr,          s: sim.asr,          u: '%' },
                            { k: 'Stability',     c: curr.stability,    s: sim.stability,    u: ''  },
                          ].map(({ k, c, s, u }) => (
                            <div key={k} className="flex justify-between items-center py-1.5 text-xs border-b border-border/20 last:border-0">
                              <span className="text-muted-foreground">{k}</span>
                              <span className="font-mono">
                                {c.toFixed(1)}{u} → <span className={s > c ? 'text-emerald-400' : s < c ? 'text-orange-400' : ''}>{s.toFixed(1)}{u}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Interpretation */}
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/20 border border-border/30">
                    <Info className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        {result.delta.asr > 0
                          ? `Shifting ${shiftPercent}% from ${fromCarrier} to ${toCarrier} is projected to improve portfolio ASR by ${result.delta.asr.toFixed(1)} points.`
                          : result.delta.asr < -0.5
                          ? `Shifting ${shiftPercent}% from ${fromCarrier} to ${toCarrier} is projected to reduce portfolio ASR by ${Math.abs(result.delta.asr).toFixed(1)} points — consider a smaller shift.`
                          : `Minimal ASR impact projected — portfolio ASR is expected to remain stable.`
                        }
                        {result.delta.concentration > 5 && ` Vendor concentration increases by ${result.delta.concentration} points — monitor for dependency risk.`}
                      </p>
                      <p className="text-[10px] text-muted-foreground/50">
                        Projections use weighted carrier quality metrics. Actual impact depends on live traffic distribution and prefix mix.
                        To approve a recommendation, return to Route Optimisation.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {!result && !simulateMut.isPending && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground/40">
              <FlaskConical className="w-12 h-12" />
              <div className="text-center">
                <p className="text-sm">Configure a scenario above and run the simulation.</p>
                <p className="text-xs mt-1">Results show projected portfolio impact — no production changes.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
