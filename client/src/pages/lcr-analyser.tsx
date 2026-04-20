import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { GitBranch, TrendingDown, DollarSign, Minus, Trophy, AlertTriangle, Info, Search } from "lucide-react";
import type { RateCard } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LcrRoute {
  rank: number;
  rateCardId: number;
  carrierName: string;
  rateCardName: string;
  currency: string;
  prefix: string;
  country: string;
  breakout: string;
  ratePerMin: number;
  savingsVsBest: number;
  pctMoreThanBest: number;
  margin: number | null;
}

interface LcrResult {
  number: string;
  routesFound: number;
  bestRate: number | null;
  worstRate: number | null;
  maxSaving: number | null;
  clientRate: { prefix: string; country: string | null; ratePerMin: number } | null;
  routes: LcrRoute[];
}

// ── Form schema ───────────────────────────────────────────────────────────────
const schema = z.object({
  number:           z.string().min(3, "Enter at least a country code + area code"),
  clientRateCardId: z.string().optional(),
  originPrefix:     z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(rate: number | null, currency = "USD") {
  if (rate === null) return "—";
  return `${rate.toFixed(6)} ${currency}`;
}

function rankColor(rank: number, total: number): string {
  if (total === 1) return "bg-primary/10 border-l-4 border-primary";
  if (rank === 1) return "bg-emerald-500/10 border-l-4 border-emerald-500";
  if (rank === total) return "bg-rose-500/10 border-l-4 border-rose-500";
  return "hover:bg-muted/40";
}

function marginBadge(margin: number | null) {
  if (margin === null) return null;
  if (margin >= 0.002)  return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"  variant="outline">+{margin.toFixed(4)}</Badge>;
  if (margin >= 0)      return <Badge className="bg-amber-500/20  text-amber-400  border-amber-500/30"   variant="outline">+{margin.toFixed(4)}</Badge>;
  return                       <Badge className="bg-rose-500/20   text-rose-400   border-rose-500/30"    variant="outline">{margin.toFixed(4)}</Badge>;
}

// Rate bar relative to worst rate
function RateBar({ rate, worst }: { rate: number; worst: number }) {
  const pct = worst > 0 ? Math.round((rate / worst) * 100) : 100;
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", pct <= 50 ? "bg-emerald-500" : pct <= 80 ? "bg-amber-500" : "bg-rose-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LcrAnalyserPage() {
  const { toast } = useToast();
  const [result, setResult] = useState<LcrResult | null>(null);

  // Fetch all rate cards for the optional client card selector
  const { data: rateCards = [] } = useQuery<RateCard[]>({ queryKey: ["/api/rate-cards"] });
  const clientCards = rateCards.filter(c => c.cardType === "client");

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { number: "", clientRateCardId: "__none__", originPrefix: "" },
  });

  const analyse = useMutation({
    mutationFn: (values: FormValues) =>
      apiRequest("POST", "/api/lcr/analyse", {
        number:           values.number,
        clientRateCardId: values.clientRateCardId && values.clientRateCardId !== "__none__"
          ? Number(values.clientRateCardId)
          : undefined,
        originPrefix:     values.originPrefix?.trim() || undefined,
      }),
    onSuccess: async (res) => {
      const data: LcrResult = await res.json();
      setResult(data);
      if (data.routesFound === 0) {
        toast({ title: "No routes found", description: "No vendor rate cards match that number. Check your rate cards have the right prefixes.", variant: "destructive" });
      }
    },
    onError: async (err: any) => {
      let msg = err.message;
      try { msg = (await err.response?.json())?.message ?? msg; } catch {}
      toast({ title: "Analysis failed", description: msg, variant: "destructive" });
    },
  });

  function onSubmit(values: FormValues) {
    setResult(null);
    analyse.mutate(values);
  }

  const routes  = result?.routes ?? [];
  const worst   = result?.worstRate ?? 0;
  const hasMargin = routes.some(r => r.margin !== null);

  return (
    <TooltipProvider>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <GitBranch className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">LCR Analyser</h1>
            <p className="text-sm text-muted-foreground">
              Enter a destination number to instantly rank all vendor routes by cost — least-cost first.
            </p>
          </div>
        </div>

        {/* ── Input panel ── */}
        <Card>
          <CardContent className="pt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-4 items-end">

                <FormField control={form.control} name="number" render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Destination Number (CLD)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        data-testid="input-lcr-number"
                        placeholder="e.g. 447911123456 or +44 7911 123456"
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="originPrefix" render={({ field }) => (
                  <FormItem className="w-44">
                    <FormLabel className="flex items-center gap-1">
                      Origin Prefix
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-56">
                          Optional. Enter caller origin prefix (e.g. 44 for UK) to filter origin-based vendor rates.
                        </TooltipContent>
                      </Tooltip>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        data-testid="input-lcr-origin"
                        placeholder="e.g. 44 (UK)"
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="clientRateCardId" render={({ field }) => (
                  <FormItem className="w-64">
                    <FormLabel className="flex items-center gap-1">
                      Client Rate Card
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-56">
                          Optional. Select a client tariff to calculate the margin you earn on each vendor route.
                        </TooltipContent>
                      </Tooltip>
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-lcr-client-card">
                          <SelectValue placeholder="None (cost only)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">None — cost analysis only</SelectItem>
                        {clientCards.map(c => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.vendorName} — {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <Button
                  type="submit"
                  data-testid="button-lcr-analyse"
                  disabled={analyse.isPending}
                  className="gap-2 shrink-0"
                >
                  <Search className="h-4 w-4" />
                  {analyse.isPending ? "Analysing…" : "Analyse"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* ── Loading skeleton ── */}
        {analyse.isPending && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {/* ── Results ── */}
        {result && !analyse.isPending && (
          <div className="space-y-5" data-testid="lcr-results">

            {/* Summary bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/15"><Trophy className="h-4 w-4 text-emerald-400" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Best Rate</p>
                    <p className="text-sm font-semibold text-emerald-400" data-testid="text-lcr-best-rate">
                      {result.bestRate !== null ? `${result.bestRate.toFixed(6)} ${routes[0]?.currency ?? "USD"}` : "—"}
                    </p>
                    {routes[0] && <p className="text-xs text-muted-foreground truncate max-w-28">{routes[0].carrierName}</p>}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-rose-500/30 bg-rose-500/5">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-rose-500/15"><AlertTriangle className="h-4 w-4 text-rose-400" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Worst Rate</p>
                    <p className="text-sm font-semibold text-rose-400" data-testid="text-lcr-worst-rate">
                      {result.worstRate !== null ? `${result.worstRate.toFixed(6)} ${routes[routes.length - 1]?.currency ?? "USD"}` : "—"}
                    </p>
                    {routes[routes.length - 1] && <p className="text-xs text-muted-foreground truncate max-w-28">{routes[routes.length - 1].carrierName}</p>}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-cyan-500/30 bg-cyan-500/5">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-cyan-500/15"><TrendingDown className="h-4 w-4 text-cyan-400" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Max Saving / min</p>
                    <p className="text-sm font-semibold text-cyan-400" data-testid="text-lcr-max-saving">
                      {result.maxSaving !== null && result.maxSaving > 0 ? `${result.maxSaving.toFixed(6)} ${routes[0]?.currency ?? "USD"}` : "All same"}
                    </p>
                    {result.routesFound > 1 && result.maxSaving !== null && result.bestRate !== null && result.bestRate > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {((result.maxSaving / result.worstRate!) * 100).toFixed(1)}% cheaper
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className={cn(
                result.clientRate ? "border-violet-500/30 bg-violet-500/5" : "border-border/40 bg-muted/20"
              )}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", result.clientRate ? "bg-violet-500/15" : "bg-muted/30")}>
                    <DollarSign className={cn("h-4 w-4", result.clientRate ? "text-violet-400" : "text-muted-foreground")} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Client Rate</p>
                    {result.clientRate ? (
                      <>
                        <p className="text-sm font-semibold text-violet-400" data-testid="text-lcr-client-rate">
                          {result.clientRate.ratePerMin.toFixed(6)} {routes[0]?.currency ?? "USD"}
                        </p>
                        <p className="text-xs text-muted-foreground">Prefix {result.clientRate.prefix}</p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">No client card selected</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Routes count badge */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{result.routesFound}</span> vendor route{result.routesFound !== 1 ? "s" : ""} for{" "}
                <span className="font-mono font-semibold text-foreground">+{result.number}</span>
                {" "}— longest-prefix match, sorted cheapest first
              </p>
              {result.routesFound === 0 && (
                <Badge variant="outline" className="text-amber-400 border-amber-500/30">
                  <AlertTriangle className="h-3 w-3 mr-1" />No matches
                </Badge>
              )}
            </div>

            {/* Routes table */}
            {routes.length > 0 && (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-lcr-routes">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border/50">
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground w-10">#</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Carrier</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Country</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Breakout</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Prefix</th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground">Rate / min</th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground w-28">vs Best</th>
                        {hasMargin && (
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Margin</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {routes.map(r => (
                        <tr
                          key={r.rateCardId + "-" + r.prefix}
                          data-testid={`row-lcr-route-${r.rank}`}
                          className={cn(
                            "border-b border-border/30 transition-colors",
                            rankColor(r.rank, routes.length)
                          )}
                        >
                          {/* Rank */}
                          <td className="px-4 py-3">
                            <span className={cn(
                              "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold",
                              r.rank === 1 ? "bg-emerald-500/20 text-emerald-400"
                              : r.rank === routes.length && routes.length > 1 ? "bg-rose-500/20 text-rose-400"
                              : "bg-muted text-muted-foreground"
                            )}>
                              {r.rank}
                            </span>
                          </td>

                          {/* Carrier */}
                          <td className="px-4 py-3">
                            <div className="font-medium" data-testid={`text-carrier-${r.rank}`}>{r.carrierName}</div>
                            <div className="text-xs text-muted-foreground">{r.rateCardName}</div>
                          </td>

                          {/* Country */}
                          <td className="px-4 py-3 text-muted-foreground">
                            {r.country || <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />}
                          </td>

                          {/* Breakout */}
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {r.breakout || <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />}
                          </td>

                          {/* Prefix */}
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">+{r.prefix}</span>
                          </td>

                          {/* Rate / bar */}
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <RateBar rate={r.ratePerMin} worst={worst} />
                              <span
                                className={cn(
                                  "font-mono text-xs font-semibold",
                                  r.rank === 1 ? "text-emerald-400"
                                  : r.rank === routes.length && routes.length > 1 ? "text-rose-400"
                                  : "text-foreground"
                                )}
                                data-testid={`text-rate-${r.rank}`}
                              >
                                {r.ratePerMin.toFixed(6)}
                              </span>
                            </div>
                          </td>

                          {/* vs Best */}
                          <td className="px-4 py-3 text-right">
                            {r.rank === 1 ? (
                              <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-xs">Best</Badge>
                            ) : (
                              <span className="text-rose-400 text-xs font-mono">+{r.pctMoreThanBest.toFixed(1)}%</span>
                            )}
                          </td>

                          {/* Margin (if client card selected) */}
                          {hasMargin && (
                            <td className="px-4 py-3 text-right">
                              {marginBadge(r.margin)}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Table footer note */}
                <div className="px-4 py-2.5 border-t border-border/30 bg-muted/10 flex items-center gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground/70">
                    Rates sourced from local vendor rate cards via longest-prefix match. Import updated rate sheets in
                    {" "}<a href="/rate-cards?type=vendor" className="underline hover:text-foreground">Vendor Rate Cards</a>.
                    {hasMargin && " Margin = client rate − vendor rate."}
                  </p>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── Empty / intro state ── */}
        {!result && !analyse.isPending && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="p-4 rounded-2xl bg-muted/30 mb-4">
              <GitBranch className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-base font-medium text-muted-foreground">Enter a number to analyse routing cost</h3>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
              The analyser will find the longest matching prefix in every vendor rate card and rank all available routes from cheapest to most expensive.
            </p>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
