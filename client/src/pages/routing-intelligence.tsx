import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Workflow, Plus, Trash2, ToggleLeft, ToggleRight, AlertTriangle, CheckCircle2, Clock, Zap, Bell, ShieldOff, ArrowDown, Info, ChevronDown, Play, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface RoutingRule {
  id: number;
  name: string;
  enabled: boolean;
  conditionMetric: string;
  conditionOperator: string;
  conditionThreshold: number;
  conditionDurationMin: number;
  scopeVendor: string | null;
  scopeDestination: string | null;
  actionType: string;
  actionPayload: string | null;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
}

const METRICS: Record<string, { label: string; unit: string }> = {
  asr:              { label: "ASR (Answer-Seizure Ratio)", unit: "%" },
  acd:              { label: "ACD (Avg Call Duration)",    unit: "s" },
  concurrent_calls: { label: "Concurrent Calls",           unit: "" },
  cost_per_min:     { label: "Cost per Minute",            unit: "$" },
  mos:              { label: "MOS Score",                  unit: "" },
  pdd:              { label: "PDD (Post-Dial Delay)",      unit: "s" },
  packet_loss:      { label: "Packet Loss",                unit: "%" },
};

const OPERATORS: Record<string, string> = {
  lt:  "drops below (<)",
  gt:  "exceeds (>)",
  lte: "is at most (≤)",
  gte: "is at least (≥)",
};

const ACTIONS: Record<string, { label: string; color: string; icon: any }> = {
  alert:           { label: "Alert Only",           color: "text-amber-400",  icon: Bell      },
  deprioritise:    { label: "Deprioritise Route",   color: "text-orange-400", icon: ArrowDown },
  flag_approval:   { label: "Flag for Approval",    color: "text-violet-400", icon: ShieldOff },
  block:           { label: "Block Vendor/Route",   color: "text-rose-400",   icon: AlertTriangle },
};

function RuleBadge({ action }: { action: string }) {
  const cfg = ACTIONS[action] ?? ACTIONS.alert;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", cfg.color)}>
      <cfg.icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function metricSummary(rule: RoutingRule): string {
  const m = METRICS[rule.conditionMetric];
  const op = rule.conditionOperator;
  const t = rule.conditionThreshold;
  const dur = rule.conditionDurationMin;
  const opLabel = op === 'lt' ? '<' : op === 'gt' ? '>' : op === 'lte' ? '≤' : '≥';
  return `If ${m?.label ?? rule.conditionMetric} ${opLabel} ${t}${m?.unit ?? ''} for ${dur} min`;
}

interface EvalResult {
  ruleId: number;
  ruleName: string;
  fired: boolean;
  metric: string;
  current: number | null;
  threshold: number;
  action: string;
  message: string;
  approvalRequestId?: number;
}

export default function RoutingIntelligencePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [evalResults, setEvalResults] = useState<EvalResult[] | null>(null);
  const [form, setForm] = useState({
    name: '', conditionMetric: 'asr', conditionOperator: 'lt',
    conditionThreshold: 60, conditionDurationMin: 5,
    scopeVendor: '', scopeDestination: '',
    actionType: 'alert', actionPayload: '',
  });

  const { data: rules = [], isLoading } = useQuery<RoutingRule[]>({
    queryKey: ['/api/routing-rules'],
    staleTime: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => apiRequest('POST', '/api/routing-rules', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/routing-rules'] });
      setShowDialog(false);
      toast({ title: "Rule created", description: form.name });
      setForm({ name: '', conditionMetric: 'asr', conditionOperator: 'lt', conditionThreshold: 60, conditionDurationMin: 5, scopeVendor: '', scopeDestination: '', actionType: 'alert', actionPayload: '' });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest('PATCH', `/api/routing-rules/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/routing-rules'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/routing-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/routing-rules'] });
      toast({ title: "Rule deleted" });
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/routing-rules/evaluate');
      return res.json();
    },
    onSuccess: (data: any) => {
      setEvalResults(data.results ?? []);
      const fired = (data.results ?? []).filter((r: EvalResult) => r.fired).length;
      if (fired > 0) {
        toast({ title: `${fired} rule${fired > 1 ? 's' : ''} fired`, description: "Approval request(s) submitted to the queue." });
      } else {
        toast({ title: "Evaluation complete", description: `${data.evaluated ?? 0} rules evaluated — no actions taken.` });
      }
      qc.invalidateQueries({ queryKey: ['/api/routing-rules'] });
    },
    onError: (e: any) => toast({ title: "Evaluation failed", description: e.message, variant: "destructive" }),
  });

  const activeRules = rules.filter(r => r.enabled).length;
  const triggeredToday = rules.filter(r => r.lastTriggeredAt && new Date(r.lastTriggeredAt).toDateString() === new Date().toDateString()).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
              <Workflow className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Routing Intelligence</h1>
              <p className="text-sm text-muted-foreground">Automated rule-based routing decisions with approval gates</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => evaluateMutation.mutate()}
              disabled={evaluateMutation.isPending}
              data-testid="button-evaluate-rules"
              className="gap-1.5"
            >
              {evaluateMutation.isPending
                ? <RefreshCw className="h-4 w-4 animate-spin" />
                : <Play className="h-4 w-4" />}
              Evaluate Now
            </Button>
            <Button onClick={() => setShowDialog(true)} data-testid="button-new-rule">
              <Plus className="h-4 w-4 mr-2" /> New Rule
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Rules", value: rules.length, color: "text-foreground" },
            { label: "Active Rules", value: activeRules, color: "text-emerald-400" },
            { label: "Triggered Today", value: triggeredToday, color: triggeredToday > 0 ? "text-amber-400" : "text-muted-foreground" },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4 text-center">
              <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-blue-300">How Routing Intelligence works</p>
            <p>Rules are evaluated every 5 minutes against live Sippy metrics. When a condition is met for the specified duration, the action fires automatically. <strong className="text-foreground/80">Flag for Approval</strong> and <strong className="text-foreground/80">Block</strong> actions are queued in the Approval Queue first — no route changes happen without a human sign-off.</p>
          </div>
        </div>

        {/* Evaluation Results */}
        {evalResults && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-cyan-400" />
                <h2 className="text-sm font-semibold">Last Evaluation Results</h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {evalResults.filter(r => r.fired).length} fired / {evalResults.length} evaluated
              </span>
            </div>
            <div className="divide-y divide-border/40">
              {evalResults.length === 0 && (
                <div className="px-5 py-4 text-xs text-muted-foreground">No rules to evaluate.</div>
              )}
              {evalResults.map(r => (
                <div key={r.ruleId} className="px-5 py-3 flex items-start gap-3">
                  {r.fired
                    ? <CheckCircle2 className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                    : <Clock className="h-4 w-4 text-muted-foreground/50 mt-0.5 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold">{r.ruleName}</span>
                      {r.fired && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-amber-500/10 text-amber-400 border-amber-500/20">
                          FIRED
                        </Badge>
                      )}
                      {r.approvalRequestId && (
                        <a href="/approval-queue" className="text-[10px] text-violet-400 hover:underline flex items-center gap-0.5">
                          <ExternalLink className="h-2.5 w-2.5" />Approval #{r.approvalRequestId}
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.message}</p>
                    {r.current !== null && (
                      <p className="text-xs text-muted-foreground/60 mt-0.5">
                        {r.metric}: <span className={cn("font-mono", r.fired ? "text-amber-400" : "text-foreground/60")}>
                          {r.current.toFixed(2)}
                        </span> vs threshold {r.threshold}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rules list */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Rules ({rules.length})</h2>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading rules…</div>
          ) : rules.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-muted/30 flex items-center justify-center">
                <Workflow className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">No rules yet. Create your first rule to automate routing decisions.</p>
              <Button size="sm" variant="outline" onClick={() => setShowDialog(true)}>Create First Rule</Button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {rules.map(rule => (
                <div key={rule.id} className={cn("px-5 py-4 flex items-start gap-4 transition-colors", !rule.enabled && "opacity-50")}>
                  <button
                    onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                    data-testid={`toggle-rule-${rule.id}`}
                    className="mt-0.5 shrink-0"
                  >
                    {rule.enabled
                      ? <ToggleRight className="h-5 w-5 text-emerald-400" />
                      : <ToggleLeft className="h-5 w-5 text-muted-foreground/40" />}
                  </button>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{rule.name}</span>
                      {rule.scopeVendor && <Badge variant="outline" className="text-[10px]">Vendor: {rule.scopeVendor}</Badge>}
                      {rule.scopeDestination && <Badge variant="outline" className="text-[10px]">Dest: {rule.scopeDestination}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{metricSummary(rule)}</p>
                    <div className="flex items-center gap-4">
                      <RuleBadge action={rule.actionType} />
                      {rule.triggerCount > 0 && (
                        <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                          <Zap className="h-3 w-3" />
                          Triggered {rule.triggerCount}× 
                          {rule.lastTriggeredAt && ` · Last: ${new Date(rule.lastTriggeredAt).toLocaleDateString()}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => deleteMutation.mutate(rule.id)}
                    data-testid={`delete-rule-${rule.id}`}
                    className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create rule dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Routing Intelligence Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Rule Name</label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Low ASR Alert — Callntalk"
                data-testid="input-rule-name"
              />
            </div>

            <div className="rounded-lg border border-border p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Condition</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Metric</label>
                  <Select value={form.conditionMetric} onValueChange={v => setForm(f => ({ ...f, conditionMetric: v }))}>
                    <SelectTrigger data-testid="select-metric"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(METRICS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Operator</label>
                  <Select value={form.conditionOperator} onValueChange={v => setForm(f => ({ ...f, conditionOperator: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(OPERATORS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Threshold {METRICS[form.conditionMetric]?.unit ? `(${METRICS[form.conditionMetric].unit})` : ''}
                  </label>
                  <Input
                    type="number"
                    value={form.conditionThreshold}
                    onChange={e => setForm(f => ({ ...f, conditionThreshold: Number(e.target.value) }))}
                    data-testid="input-threshold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">For (minutes)</label>
                  <Input
                    type="number"
                    value={form.conditionDurationMin}
                    onChange={e => setForm(f => ({ ...f, conditionDurationMin: Number(e.target.value) }))}
                    min={1}
                    data-testid="input-duration"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Scope: Vendor (optional)</label>
                <Input
                  value={form.scopeVendor}
                  onChange={e => setForm(f => ({ ...f, scopeVendor: e.target.value }))}
                  placeholder="e.g. Callntalk"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Scope: Destination (optional)</label>
                <Input
                  value={form.scopeDestination}
                  onChange={e => setForm(f => ({ ...f, scopeDestination: e.target.value }))}
                  placeholder="e.g. 92 (Pakistan)"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Action</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(ACTIONS).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setForm(f => ({ ...f, actionType: k }))}
                    data-testid={`action-${k}`}
                    className={cn(
                      "flex items-center gap-2 p-3 rounded-lg border text-xs font-medium transition-all text-left",
                      form.actionType === k
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border hover:border-border/80 hover:bg-muted/30 text-muted-foreground"
                    )}
                  >
                    <v.icon className={cn("h-3.5 w-3.5 shrink-0", form.actionType === k ? v.color : "")} />
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
              data-testid="button-save-rule"
            >
              Create Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
