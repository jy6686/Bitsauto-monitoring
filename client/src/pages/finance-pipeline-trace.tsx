/**
 * Invoice Pipeline Trace
 *
 * One customer, one period, and an independent verdict for every stage.
 *
 * This exists because a customer with real switch traffic produced no invoice
 * and nothing in the product could say why — the answer had to be
 * reconstructed by reading source and querying tables by hand, and the first
 * attempt blamed the wrong stage. Dashboard counts cannot answer it: they
 * aggregate across customers, so an account that never entered the pipeline
 * looks exactly like one with no traffic.
 *
 * An earlier version stopped at the first failure. That hid too much: knowing
 * "traffic found, but no tariff" tells Finance what to fix, where "stopped at
 * Tariff" leaves open whether the customer even had calls. Every stage now
 * reports on its own, and a stage whose prerequisite failed says NOT EXECUTED
 * rather than posing as a failure of its own.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, XCircle, MinusCircle, Search, RefreshCw, Route,
} from "lucide-react";

/**
 * Every stage reports on its own. A stage whose prerequisite failed shows as
 * NOT EXECUTED rather than as a failure of its own — blaming Rating for a
 * missing tariff sends Finance to fix the wrong thing.
 */
const STAGE_ICON = {
  pass:         { Icon: CheckCircle2, tone: "text-emerald-500" },
  fail:         { Icon: XCircle,      tone: "text-red-500" },
  not_executed: { Icon: MinusCircle,  tone: "text-muted-foreground" },
} as const;

interface SippyAccount {
  iAccount: number; displayName: string; companyName: string | null;
}
type StageStatus = "pass" | "fail" | "not_executed";
interface Stage {
  stage: string; status: StageStatus; detail: string; remedy?: string;
}
interface Trace {
  customer: string; periodStart: string; periodEnd: string;
  stages: Stage[]; verdict: string;
  summary?: { passed: number; failed: number; notExecuted: number; total: number };
}

/** Last fully-closed week, Monday–Sunday: the period Finance actually bills. */
function lastFullWeek() {
  const now = new Date();
  const dow = now.getUTCDay();
  const thisMon = new Date(now);
  thisMon.setUTCDate(now.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  const start = new Date(thisMon); start.setUTCDate(thisMon.getUTCDate() - 7);
  const end = new Date(thisMon);   end.setUTCDate(thisMon.getUTCDate() - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function StageRow({ s, index, last }: { s: Stage; index: number; last: boolean }) {
  const { Icon, tone } = STAGE_ICON[s.status] ?? STAGE_ICON.not_executed;
  const muted = s.status === "not_executed";
  return (
    <div className="flex gap-3 py-3" data-testid={`stage-${index}`}>
      <div className="flex flex-col items-center shrink-0">
        <Icon className={`w-4 h-4 ${tone}`} />
        {!last && <div className="w-px flex-1 bg-border mt-1" />}
      </div>
      <div className="min-w-0 flex-1 -mt-0.5">
        <p className={`text-sm font-medium ${muted ? "text-muted-foreground" : ""}`}>{s.stage}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{s.detail}</p>
        {s.remedy && (
          <p className="text-xs mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-amber-600 dark:text-amber-400">
            <span className="font-medium">What fixes it: </span>{s.remedy}
          </p>
        )}
      </div>
    </div>
  );
}

export default function FinancePipelineTracePage() {
  const week = lastFullWeek();
  const [customer, setCustomer]       = useState("");
  const [periodStart, setPeriodStart] = useState(week.start);
  const [periodEnd, setPeriodEnd]     = useState(week.end);
  const [submitted, setSubmitted]     = useState<{ c: string; s: string; e: string } | null>(null);

  const { data: accounts } = useQuery<SippyAccount[]>({
    queryKey: ["/api/invoices/sippy-accounts"],
    queryFn: () => apiRequest("GET", "/api/invoices/sippy-accounts").then(r => r.json()),
  });

  const qs = submitted
    ? `customer=${encodeURIComponent(submitted.c)}&periodStart=${submitted.s}&periodEnd=${submitted.e}`
    : "";
  const { data: trace, isLoading, error } = useQuery<Trace>({
    queryKey: ["/api/finance/pipeline-trace", submitted?.c, submitted?.s, submitted?.e],
    queryFn: () => apiRequest("GET", `/api/finance/pipeline-trace?${qs}`).then(r => r.json()),
    enabled: Boolean(submitted),
  });

  const names = (accounts ?? [])
    .map(a => a.companyName ?? a.displayName)
    .filter(Boolean) as string[];

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Route className="w-5 h-5" /> Invoice Pipeline Trace
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Why a customer with traffic did — or did not — become an invoice. One customer,
          one period, and an independent verdict for every stage.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-sm">Customer and period</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Customer</Label>
              {names.length > 0 ? (
                <Select value={customer} onValueChange={setCustomer}>
                  <SelectTrigger data-testid="select-customer"><SelectValue placeholder="Select a customer" /></SelectTrigger>
                  <SelectContent>
                    {names.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={customer} onChange={e => setCustomer(e.target.value)}
                  placeholder="Customer name" data-testid="input-customer" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Period start</Label>
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                data-testid="input-period-start" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Period end</Label>
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                data-testid="input-period-end" />
            </div>
          </div>
          <Button
            size="sm"
            disabled={!customer || !periodStart || !periodEnd}
            onClick={() => setSubmitted({ c: customer, s: periodStart, e: periodEnd })}
            data-testid="button-trace"
          >
            <Search className="w-3.5 h-3.5 mr-1.5" /> Trace
          </Button>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 animate-spin inline mr-2" /> Tracing…
        </div>
      )}

      {error && (
        <Card><CardContent className="py-4 text-sm text-red-500" data-testid="trace-error">
          {(error as Error).message}
        </CardContent></Card>
      )}

      {trace && !isLoading && (
        <Card data-testid="trace-result">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              {(trace.summary?.failed ?? 0) > 0
                ? <><XCircle className="w-4 h-4 text-red-500" /> {trace.verdict}</>
                : <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> {trace.verdict}</>}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {trace.customer} · {trace.periodStart} to {trace.periodEnd}
              {trace.summary && (
                <span className="ml-2 tabular-nums">
                  · {trace.summary.passed} passed · {trace.summary.failed} blocked
                  {trace.summary.notExecuted > 0 && ` · ${trace.summary.notExecuted} not executed`}
                </span>
              )}
            </p>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="divide-y divide-border">
              {trace.stages.map((s, i) => (
                <StageRow key={s.stage} s={s} index={i} last={i === trace.stages.length - 1} />
              ))}
            </div>
            {(trace.summary?.notExecuted ?? 0) > 0 && (
              <div className="flex items-center gap-2 pt-3 text-xs text-muted-foreground">
                <MinusCircle className="w-3.5 h-3.5" />
                Stages marked not executed were blocked by a prerequisite, not by their own failure.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
