import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Workflow, Hash, User, Wallet, DollarSign, GitBranch,
  TrendingDown, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronRight, Play, ArrowRight,
  Shield, Info, Minus
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type StepStatus = "ok" | "warn" | "error" | "skip" | "info";

interface SimStep {
  id: string;
  title: string;
  status: StepStatus;
  summary: string;
  detail: string;
  data?: Record<string, unknown>;
}

interface SimResult {
  steps: SimStep[];
  outcome: "connected" | "no_route" | "blocked" | "insufficient_balance" | "invalid";
}

// ── Form schema ───────────────────────────────────────────────────────────────
const schema = z.object({
  cli:       z.string().optional(),
  cld:       z.string().min(3, "Enter at least a country code"),
  accountId: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<StepStatus, { dot: string; badge: string; label: string }> = {
  ok:    { dot: "bg-emerald-500 ring-emerald-500/30", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "OK"   },
  warn:  { dot: "bg-amber-500  ring-amber-500/30",   badge: "bg-amber-500/15  text-amber-400  border-amber-500/30",  label: "WARN" },
  error: { dot: "bg-rose-500   ring-rose-500/30",    badge: "bg-rose-500/15   text-rose-400   border-rose-500/30",   label: "FAIL" },
  skip:  { dot: "bg-muted      ring-muted/30",       badge: "bg-muted/40      text-muted-foreground border-border",  label: "SKIP" },
  info:  { dot: "bg-cyan-500   ring-cyan-500/30",    badge: "bg-cyan-500/15   text-cyan-400   border-cyan-500/30",   label: "INFO" },
};

const STEP_ICONS: Record<string, React.ElementType> = {
  normalize:     Hash,
  account:       User,
  balance:       Wallet,
  tariff:        DollarSign,
  routing_group: GitBranch,
  lcr:           TrendingDown,
  outcome:       CheckCircle2,
};

function stepIcon(id: string, status: StepStatus) {
  const Icon = STEP_ICONS[id] ?? Info;
  return (
    <div className={cn(
      "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ring-4",
      STATUS_STYLE[status].dot,
    )}>
      <Icon className="h-4 w-4 text-white" />
    </div>
  );
}

// ── Step card (expandable) ────────────────────────────────────────────────────
function StepCard({ step, index, isLast }: { step: SimStep; index: number; isLast: boolean }) {
  const [open, setOpen] = useState(step.status === "error" || step.status === "warn");
  const s = STATUS_STYLE[step.status];

  // Render structured data
  function renderData(data: Record<string, unknown>) {
    // Top routes table
    if (Array.isArray((data as any).topRoutes)) {
      return (
        <div className="mt-2 border border-border/40 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                {["#","Carrier","Prefix","Country","Rate/min"].map(h => (
                  <th key={h} className="px-3 py-1.5 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.topRoutes as any[]).map((r: any) => (
                <tr key={r.rank} className="border-t border-border/30">
                  <td className="px-3 py-1.5 text-muted-foreground">{r.rank}</td>
                  <td className="px-3 py-1.5 font-medium">{r.carrier}</td>
                  <td className="px-3 py-1.5 font-mono">+{r.prefix}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.country || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-emerald-400">{Number(r.ratePerMin).toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    // Routing group members
    if (Array.isArray((data as any).members)) {
      return (
        <div className="mt-2 border border-border/40 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                {["Pref","Weight","Vendor/Connection","Dest Set"].map(h => (
                  <th key={h} className="px-3 py-1.5 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.members as any[]).map((m: any, i: number) => (
                <tr key={i} className="border-t border-border/30">
                  <td className="px-3 py-1.5">{m.preference ?? "—"}</td>
                  <td className="px-3 py-1.5">{m.weight ?? "—"}</td>
                  <td className="px-3 py-1.5 font-medium">{m.vendor ?? `#${m.iConnection}`}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{m.iDestinationSet ? `#${m.iDestinationSet}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    // Generic key-value
    const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && !Array.isArray(v));
    if (!entries.length) return null;
    return (
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground capitalize">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}:</span>
            <span className="font-mono font-medium truncate">{String(v)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative flex gap-4">
      {/* Vertical connector line */}
      {!isLast && (
        <div className="absolute left-4 top-9 bottom-0 w-0.5 bg-border/40 -translate-x-1/2" />
      )}

      {/* Step dot */}
      <div className="relative z-10 mt-0.5">
        {stepIcon(step.id, step.status)}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <button
          className="w-full text-left"
          onClick={() => setOpen(o => !o)}
          data-testid={`step-${step.id}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Step {index + 1}
                </span>
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", s.badge)}>
                  {s.label}
                </Badge>
              </div>
              <h3 className="font-semibold text-sm mt-0.5">{step.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{step.summary}</p>
            </div>
            <div className="flex-shrink-0 mt-1">
              {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </button>

        {open && (
          <div className="mt-3 pl-0.5">
            <Card className="border-border/40 bg-muted/10">
              <CardContent className="p-3 space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">{step.detail}</p>
                {step.data && Object.keys(step.data).length > 0 && renderData(step.data)}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Outcome banner ────────────────────────────────────────────────────────────
function OutcomeBanner({ step, cli, cld }: { step: SimStep; cli: string; cld: string }) {
  const ok = step.status === "ok";
  const d  = step.data as any;

  return (
    <Card className={cn(
      "border-2 overflow-hidden",
      ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5"
    )}>
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className={cn("p-3 rounded-xl flex-shrink-0", ok ? "bg-emerald-500/15" : "bg-rose-500/15")}>
            {ok
              ? <CheckCircle2 className="h-7 w-7 text-emerald-400" />
              : <XCircle     className="h-7 w-7 text-rose-400"    />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className={cn("text-lg font-bold", ok ? "text-emerald-400" : "text-rose-400")} data-testid="text-sim-outcome">
              {step.summary}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{step.detail}</p>

            {ok && d?.bestVendor && (
              <div className="mt-3 flex flex-wrap gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Via carrier</span>
                  <span className="ml-1.5 font-semibold text-foreground">{d.bestVendor}</span>
                </div>
                {d.bestRate !== null && (
                  <div>
                    <span className="text-muted-foreground">Vendor cost</span>
                    <span className="ml-1.5 font-mono font-semibold text-cyan-400">{Number(d.bestRate).toFixed(6)}/min</span>
                  </div>
                )}
                {d.clientRate !== null && d.clientRate !== undefined && (
                  <div>
                    <span className="text-muted-foreground">Sell rate</span>
                    <span className="ml-1.5 font-mono font-semibold text-violet-400">{Number(d.clientRate).toFixed(6)}/min</span>
                  </div>
                )}
                {d.margin !== null && d.margin !== undefined && (
                  <div>
                    <span className="text-muted-foreground">Margin</span>
                    <span className={cn("ml-1.5 font-mono font-semibold", Number(d.margin) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {Number(d.margin) >= 0 ? "+" : ""}{Number(d.margin).toFixed(6)}/min
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Call path visual */}
            <div className="mt-3 flex items-center gap-2 text-xs font-mono text-muted-foreground">
              <span className="bg-muted/40 px-2 py-1 rounded">+{cli || "unknown"}</span>
              <ArrowRight className="h-3 w-3 flex-shrink-0" />
              <span className={cn("px-2 py-1 rounded font-semibold", ok ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>
                +{cld}
              </span>
              {ok && d?.bestVendor && (
                <>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="bg-cyan-500/15 text-cyan-300 px-2 py-1 rounded">{d.bestVendor}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CallFlowSimulatorPage() {
  const { toast } = useToast();
  const [result, setResult] = useState<SimResult | null>(null);
  const [submittedCli, setSubmittedCli] = useState("");
  const [submittedCld, setSubmittedCld] = useState("");

  const { data: accountsData } = useQuery<{ accounts: { iAccount: number; username: string; description?: string }[] }>({
    queryKey: ["/api/sippy/accounts"],
  });
  const accounts = accountsData?.accounts ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { cli: "", cld: "", accountId: "__none__" },
  });

  const simulate = useMutation({
    mutationFn: (values: FormValues) =>
      apiRequest("POST", "/api/simulator/run", {
        cli:       values.cli?.trim() || undefined,
        cld:       values.cld.trim(),
        accountId: values.accountId && values.accountId !== "__none__" ? Number(values.accountId) : undefined,
      }),
    onSuccess: async (res) => {
      const data: SimResult = await res.json();
      setResult(data);
    },
    onError: async (err: any) => {
      let msg = err.message;
      try { msg = (await err.response?.json())?.message ?? msg; } catch {}
      toast({ title: "Simulation failed", description: msg, variant: "destructive" });
    },
  });

  function onSubmit(values: FormValues) {
    const cli = values.cli?.replace(/^\+/, "").replace(/\D/g, "") ?? "";
    const cld = values.cld.replace(/^\+/, "").replace(/\D/g, "");
    setSubmittedCli(cli);
    setSubmittedCld(cld);
    setResult(null);
    simulate.mutate(values);
  }

  // Non-outcome steps (all except last)
  const traceSteps = result ? result.steps.slice(0, -1) : [];
  const outcomeStep = result ? result.steps[result.steps.length - 1] : null;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <Workflow className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Call Flow Simulator</h1>
          <p className="text-sm text-muted-foreground">
            Trace the exact decision path Sippy would take — without making a real call.
          </p>
        </div>
      </div>

      {/* ── Input panel ── */}
      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="cli" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Caller (CLI) — optional</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-sim-cli" placeholder="+447700900000" autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="cld" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destination (CLD) <span className="text-rose-400">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-sim-cld" placeholder="+442012345678" autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <FormField control={form.control} name="accountId" render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Billing Account — optional</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-sim-account">
                          <SelectValue placeholder="None — route-only simulation" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">None — route-only simulation</SelectItem>
                        {accounts.map(a => (
                          <SelectItem key={a.iAccount} value={String(a.iAccount)}>
                            {a.username}{a.description ? ` · ${a.description}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <Button
                  type="submit"
                  data-testid="button-sim-run"
                  disabled={simulate.isPending}
                  className="gap-2 shrink-0"
                >
                  <Play className="h-4 w-4" />
                  {simulate.isPending ? "Simulating…" : "Run Simulation"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* ── Loading skeleton ── */}
      {simulate.isPending && (
        <div className="space-y-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="flex gap-4">
              <div className="w-9 h-9 rounded-full bg-muted/40 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 bg-muted/40 rounded animate-pulse w-24" />
                <div className="h-4 bg-muted/40 rounded animate-pulse w-48" />
                <div className="h-3 bg-muted/40 rounded animate-pulse w-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Simulation trace ── */}
      {result && !simulate.isPending && (
        <div className="space-y-2" data-testid="sim-trace">

          {/* Section label */}
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Simulation Trace
            </h2>
            <div className="flex-1 h-px bg-border/40" />
            <span className="text-xs text-muted-foreground">{traceSteps.length} steps</span>
          </div>

          {/* Steps */}
          <div>
            {traceSteps.map((step, idx) => (
              <StepCard
                key={step.id}
                step={step}
                index={idx}
                isLast={idx === traceSteps.length - 1}
              />
            ))}
          </div>

          {/* Outcome banner */}
          {outcomeStep && (
            <div className="pt-2">
              <OutcomeBanner
                step={outcomeStep}
                cli={submittedCli}
                cld={submittedCld}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ── */}
      {!result && !simulate.isPending && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-2xl bg-muted/30 mb-4">
            <Workflow className="h-10 w-10 text-muted-foreground/50" />
          </div>
          <h3 className="text-base font-medium text-muted-foreground">No simulation run yet</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
            Enter a destination number and optionally a billing account, then click "Run Simulation"
            to trace the routing decision step-by-step — without placing a real call.
          </p>
          <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <Info className="h-3.5 w-3.5" />
            <span>Simulation uses local rate cards + live Sippy account data. No calls are made.</span>
          </div>
        </div>
      )}
    </div>
  );
}
