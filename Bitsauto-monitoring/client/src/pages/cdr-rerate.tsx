import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { WorkspaceShell } from "@/components/workspace-shell";
import {
  AlertTriangle, TrendingDown, TrendingUp, Minus,
  RefreshCw, Trash2, Activity, DollarSign, BarChart3, Clock,
} from "lucide-react";

type CdrRerateRun = {
  id: number;
  name: string;
  mode: string;
  fromDate: string;
  toDate: string;
  iTariffFilter: string | null;
  flatRatePerMin: number | null;
  status: string;
  snapshotCount: number | null;
  originalCost: number | null;
  reratedCost: number | null;
  delta: number | null;
  savingsPct: number | null;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
};

const formSchema = z.object({
  name:           z.string().min(1, "Name is required"),
  fromDate:       z.string().min(1, "Start date is required"),
  toDate:         z.string().min(1, "End date is required"),
  iTariffFilter:  z.string().optional(),
  flatRatePerMin: z.coerce.number().min(0, "Rate must be ≥ 0"),
  notes:          z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

function fmt(v: number | null | undefined, decimals = 4) {
  if (v == null) return "—";
  return `$${v.toFixed(decimals)}`;
}
function fmtPct(v: number | null | undefined) {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function DeltaBadge({ delta, savingsPct }: { delta: number | null; savingsPct: number | null }) {
  if (delta == null) return <Badge variant="secondary">—</Badge>;
  if (Math.abs(delta) < 0.0001) return <Badge variant="secondary" className="gap-1"><Minus className="h-3 w-3" /> No change</Badge>;
  if (delta < 0) return (
    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1">
      <TrendingDown className="h-3 w-3" /> Save {fmtPct(savingsPct)} ({fmt(Math.abs(delta), 2)})
    </Badge>
  );
  return (
    <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 gap-1">
      <TrendingUp className="h-3 w-3" /> +{fmtPct(savingsPct ? -savingsPct : null)} cost ({fmt(delta, 2)})
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'done')    return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Done</Badge>;
  if (status === 'running') return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 gap-1"><RefreshCw className="h-3 w-3 animate-spin" />Running</Badge>;
  if (status === 'failed')  return <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">Failed</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function RunRow({ run, onDelete }: { run: CdrRerateRun; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr
        className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer"
        onClick={() => setExpanded(e => !e)}
        data-testid={`row-rerate-${run.id}`}
      >
        <td className="px-4 py-3 text-sm font-medium">{run.name}</td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{run.fromDate} → {run.toDate}</td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt(run.flatRatePerMin, 6)}<span className="text-muted-foreground">/min</span></td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">{run.snapshotCount?.toLocaleString() ?? "—"}</td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt(run.originalCost, 4)}</td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt(run.reratedCost, 4)}</td>
        <td className="px-4 py-3"><DeltaBadge delta={run.delta} savingsPct={run.savingsPct} /></td>
        <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
        <td className="px-4 py-3 text-right">
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-rose-400"
            data-testid={`btn-delete-rerate-${run.id}`}
            onClick={e => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-white/5 bg-white/[0.01]">
          <td colSpan={9} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Tariff Filter</p>
                <p className="font-mono">{run.iTariffFilter ?? "All tariffs"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Completed</p>
                <p>{run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Notes</p>
                <p className="text-muted-foreground">{run.notes || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Delta</p>
                <p className={run.delta != null && run.delta < 0 ? "text-emerald-400" : run.delta != null && run.delta > 0 ? "text-rose-400" : ""}>
                  {run.delta != null ? (run.delta >= 0 ? "+" : "") + run.delta.toFixed(4) : "—"}
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function NewRunForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: `Re-rate ${today}`,
      fromDate: monthStart,
      toDate: today,
      iTariffFilter: "",
      flatRatePerMin: 0.005,
      notes: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: FormValues) => apiRequest("POST", "/api/cdr-rerate", data),
    onSuccess: async (res) => {
      const run: CdrRerateRun = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/cdr-rerate"] });
      toast({
        title: "Re-rating complete",
        description: `${run.snapshotCount?.toLocaleString() ?? 0} CDR snapshots processed.`,
      });
      form.reset();
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Re-rating failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Run Name</FormLabel>
              <FormControl><Input data-testid="input-rerate-name" placeholder="e.g. Q1 pricing scenario" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="fromDate" render={({ field }) => (
            <FormItem>
              <FormLabel>From Date</FormLabel>
              <FormControl><Input data-testid="input-rerate-from" type="date" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="toDate" render={({ field }) => (
            <FormItem>
              <FormLabel>To Date</FormLabel>
              <FormControl><Input data-testid="input-rerate-to" type="date" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="flatRatePerMin" render={({ field }) => (
            <FormItem>
              <FormLabel>Rate per Minute ($)</FormLabel>
              <FormControl>
                <Input data-testid="input-rerate-rate" type="number" step="0.000001" min="0" placeholder="0.005000" {...field} />
              </FormControl>
              <FormDescription>Applied to every CDR's duration (seconds ÷ 60 × rate).</FormDescription>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="iTariffFilter" render={({ field }) => (
            <FormItem>
              <FormLabel>Tariff Filter <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
              <FormControl>
                <Input data-testid="input-rerate-tariff" placeholder="e.g. 42 — leave blank for all" {...field} />
              </FormControl>
              <FormDescription>Restrict re-rating to a specific Sippy i_tariff ID.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="notes" render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Notes <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
              <FormControl><Textarea data-testid="input-rerate-notes" placeholder="What scenario is this testing?" rows={2} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex gap-2 text-sm text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>Re-rating is <strong>read-only</strong>. CDR snapshots are never modified — results are stored separately for scenario analysis only.</span>
        </div>

        <Button data-testid="button-run-rerate" type="submit" disabled={mutation.isPending} className="w-full sm:w-auto">
          {mutation.isPending ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Running Re-rating…</> : "Run Re-rating"}
        </Button>
      </form>
    </Form>
  );
}

export default function CdrReratePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("new");

  const { data: runs = [], isLoading } = useQuery<CdrRerateRun[]>({
    queryKey: ["/api/cdr-rerate"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/cdr-rerate/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cdr-rerate"] });
      toast({ title: "Run deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const doneRuns    = runs.filter(r => r.status === 'done');
  const totalSaved  = doneRuns.reduce((s, r) => s + (r.delta != null && r.delta < 0 ? Math.abs(r.delta) : 0), 0);
  const avgSnaps    = doneRuns.length ? Math.round(doneRuns.reduce((s, r) => s + (r.snapshotCount ?? 0), 0) / doneRuns.length) : 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">CDR Re-rating</h1>
        <p className="text-muted-foreground mt-1">
          Apply alternative rates to existing CDR snapshots for pricing scenario analysis.
          Snapshots are never modified — results are stored separately.
        </p>
      </div>

      {/* Summary strip */}
      {doneRuns.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="p-4 flex items-center gap-3">
              <Activity className="h-5 w-5 text-indigo-400" />
              <div><p className="text-xs text-muted-foreground">Total Runs</p><p className="text-xl font-semibold">{doneRuns.length}</p></div>
            </CardContent>
          </Card>
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="p-4 flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-blue-400" />
              <div><p className="text-xs text-muted-foreground">Avg CDRs / Run</p><p className="text-xl font-semibold">{avgSnaps.toLocaleString()}</p></div>
            </CardContent>
          </Card>
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="p-4 flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-emerald-400" />
              <div><p className="text-xs text-muted-foreground">Total Potential Saving</p><p className="text-xl font-semibold text-emerald-400">${totalSaved.toFixed(2)}</p></div>
            </CardContent>
          </Card>
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-amber-400" />
              <div><p className="text-xs text-muted-foreground">Last Run</p><p className="text-xl font-semibold">{doneRuns[0] ? new Date(doneRuns[0].createdAt).toLocaleDateString() : "—"}</p></div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="new" data-testid="tab-rerate-new">New Run</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-rerate-history">
            Run History {runs.length > 0 && <span className="ml-1.5 text-muted-foreground">({runs.length})</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader>
              <CardTitle className="text-base">Configure Re-rating Scenario</CardTitle>
              <CardDescription>
                Select a date range and target rate. The engine will read all locked CDR snapshots in that range and compute what your revenue would have been at the new rate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NewRunForm onSuccess={() => setTab("history")} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader>
              <CardTitle className="text-base">Re-rating Run History</CardTitle>
              <CardDescription>Click any row to expand details.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading runs…</div>
              ) : runs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No re-rating runs yet. Create one on the New Run tab.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-muted-foreground text-xs">
                        <th className="px-4 py-2.5 text-left font-medium">Name</th>
                        <th className="px-4 py-2.5 text-left font-medium">Period</th>
                        <th className="px-4 py-2.5 text-right font-medium">Rate/min</th>
                        <th className="px-4 py-2.5 text-right font-medium">CDRs</th>
                        <th className="px-4 py-2.5 text-right font-medium">Original</th>
                        <th className="px-4 py-2.5 text-right font-medium">Re-rated</th>
                        <th className="px-4 py-2.5 text-left font-medium">Impact</th>
                        <th className="px-4 py-2.5 text-left font-medium">Status</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map(run => (
                        <RunRow
                          key={run.id}
                          run={run}
                          onDelete={() => deleteMutation.mutate(run.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function CdrRerateWS() {
  return (
    <WorkspaceShell workspaceId="billing-ops">
      <CdrReratePage />
    </WorkspaceShell>
  );
}
