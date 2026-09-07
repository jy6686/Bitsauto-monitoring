import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, RefreshCw, Play, FileText, ChevronDown, ChevronRight } from "lucide-react";

/**
 * Invoice Readiness — can Finance send each customer an invoice today, and if
 * not, exactly why. Every column comes from server/finance-readiness.ts,
 * which derives it from facts the platform already computes; this page only
 * lays them out and offers the two safe actions.
 */

type Mark = "ok" | "warn" | "fail" | "none";
type Action = "configure" | "collect" | "rate" | "review" | "generate" | "done";

interface Blocker { stage: string; code: string; detail: string }
interface CustomerReadiness {
  companyId: number; name: string; iAccount: number; iTariff: number | null;
  columns: { collection: Mark; repository: Mark; rating: Mark; snapshots: Mark; reconciliation: Mark; invoice: Mark };
  blockers: Blocker[]; action: Action; ready: boolean;
  amounts: { platform: number; reference: number | null };
  invoice: { invoiceNumber: string; status: string } | null;
  counts: { calls: number; verified: number; snapshotted: number; days: number; uncovered: number };
}
interface Readiness {
  periodStart: string; periodEnd: string; days: string[];
  summary: { customersReady: number; customersTotal: number; revenueReady: number; revenueReference: number;
             coverageDays: number; periodDays: number; headline: string };
  customers: CustomerReadiness[];
  reconciliation: { outcome: string | null; error: string | null };
  generatedAt: string;
}

/** The most recent closed Monday–Sunday week, UTC — what tomorrow's run would invoice. */
function lastClosedWeek(): { start: string; end: string } {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = today.getUTCDay();                       // 0 = Sunday
  const thisMonday = new Date(today); thisMonday.setUTCDate(today.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  const lastMonday = new Date(thisMonday); lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  const lastSunday = new Date(thisMonday); lastSunday.setUTCDate(thisMonday.getUTCDate() - 1);
  return { start: lastMonday.toISOString().slice(0, 10), end: lastSunday.toISOString().slice(0, 10) };
}

const MARK: Record<Mark, { glyph: string; cls: string; title: string }> = {
  ok:   { glyph: "✓", cls: "text-emerald-400", title: "Complete" },
  warn: { glyph: "⚠", cls: "text-amber-400",   title: "Partial" },
  fail: { glyph: "✕", cls: "text-red-400",     title: "Missing" },
  none: { glyph: "—", cls: "text-slate-500",   title: "Nothing here — not a fault" },
};

const ACTION: Record<Action, { label: string; cls: string }> = {
  configure: { label: "Configure", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  collect:   { label: "Collect",   cls: "bg-red-500/10 text-red-400 border-red-500/30" },
  rate:      { label: "Rate",      cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  review:    { label: "Review",    cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  generate:  { label: "Generate",  cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  done:      { label: "Done",      cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
};

const STAGE_LABEL: Record<string, string> = {
  config: "Configuration", collection: "Collection", rating: "Rating", snapshot: "Snapshots",
  certification: "Certification", reconciliation: "Reconciliation", invoice: "Invoice",
};

const usd = (n: number) => `$${n.toFixed(2)}`;

export default function FinanceReadinessPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const week = useMemo(lastClosedWeek, []);
  const [periodStart, setPeriodStart] = useState(week.start);
  const [periodEnd, setPeriodEnd]     = useState(week.end);
  const [applied, setApplied]         = useState({ start: week.start, end: week.end });
  const [open, setOpen]               = useState<number | null>(null);

  const key = ["/api/finance/readiness", applied.start, applied.end];
  const { data, isLoading, isFetching, error, refetch } = useQuery<Readiness>({
    queryKey: key,
    queryFn: () => apiRequest("GET", `/api/finance/readiness?periodStart=${applied.start}&periodEnd=${applied.end}`).then(r => r.json()),
  });

  // Rates what the repository already holds — no Sippy fetch. The response
  // carries the resulting certification, so the toast says whether the
  // period can now invoice rather than merely that something ran.
  const rate = useMutation({
    mutationFn: (c: CustomerReadiness) =>
      apiRequest("POST", "/api/finance/rate-from-repository", {
        iAccount: c.iAccount, iTariff: String(c.iTariff), periodStart: applied.start, periodEnd: applied.end,
      }).then(r => r.json()),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: key });
      const cert = r.certification?.state ? ` Certification: ${r.certification.state}.` : "";
      toast({ title: r.status === "rated" ? "Rated from repository" : "Nothing rated", description: `${r.message ?? ""}${cert}` });
    },
    onError: (e: any) => toast({ title: "Rating failed", description: e.message, variant: "destructive" }),
  });

  // The same chain the scheduler runs — duplicate, freeze, coverage,
  // reconciliation, certification, then the generator. A draft only.
  const generate = useMutation({
    mutationFn: (c: CustomerReadiness) =>
      apiRequest("POST", "/api/invoices/pipeline-run", {
        iAccount: c.iAccount, iTariff: String(c.iTariff), customerName: c.name,
        periodStart: applied.start, periodEnd: applied.end, notes: "Generated from Invoice Readiness",
      }).then(r => r.json()),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      if (r.ok && r.invoice) toast({ title: "Draft generated", description: `${r.invoice.invoiceNumber} — ${r.invoice.lineCount} line(s). Awaiting Finance review.` });
      else toast({ title: `Refused at ${r.stage ?? "chain"}`, description: r.error ?? "The billing chain refused.", variant: "destructive" });
    },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const s = data?.summary;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            Invoice Readiness
          </h1>
          <p className="text-muted-foreground mt-1">
            Which customers Finance can invoice for the period, and the first thing blocking each one that it cannot.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs mb-1 block">Period start</Label>
            <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="w-40" data-testid="input-readiness-start" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Period end (inclusive)</Label>
            <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="w-40" data-testid="input-readiness-end" />
          </div>
          <Button variant="outline" onClick={() => setApplied({ start: periodStart, end: periodEnd })} disabled={!periodStart || !periodEnd || periodEnd < periodStart}>
            Apply
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* The three numbers management asks for */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: "Customers ready", value: s ? `${s.customersReady} / ${s.customersTotal}` : "—", sub: "every gate passed, configuration complete" },
          { label: "Revenue ready",   value: s ? `${usd(s.revenueReady)} / ${usd(s.revenueReference)}` : "—", sub: "invoiceable now / what the switch billed" },
          { label: "Historical coverage", value: s ? `${s.coverageDays} / ${s.periodDays} days` : "—", sub: "days with at least one customer collected" },
        ].map(t => (
          <Card key={t.label}>
            <CardContent className="pt-4">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">{t.label}</span>
              <p className="text-2xl font-bold mt-1 font-mono tabular-nums" data-testid={`stat-${t.label.replace(/\s+/g, "-").toLowerCase()}`}>{t.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{t.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{applied.start} → {applied.end}</CardTitle>
          <CardDescription className="text-xs">
            {s?.headline ?? (isLoading ? "Assessing…" : "")}
            {data?.reconciliation?.error ? ` · Reconciliation reference unavailable: ${data.reconciliation.error}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-sm text-red-400 py-6">{(error as any).message}</div>
          ) : isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Assessing every customer for the period…</div>
          ) : !data || data.customers.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">No company has a Sippy account mapped.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6" />
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-center">Collection</TableHead>
                    <TableHead className="text-center">Repository</TableHead>
                    <TableHead className="text-center">Rating</TableHead>
                    <TableHead className="text-center">Snapshots</TableHead>
                    <TableHead className="text-center">Reconciliation</TableHead>
                    <TableHead className="text-center">Invoice</TableHead>
                    <TableHead className="text-right">Platform / Switch</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.customers.map(c => {
                    const isOpen = open === c.companyId;
                    const canRate = c.iTariff != null && c.counts.calls > 0
                      && (c.columns.rating !== "ok" || c.columns.snapshots !== "ok");
                    const canGenerate = c.ready && !c.invoice;
                    return [
                      <TableRow key={c.companyId} className="cursor-pointer" onClick={() => setOpen(isOpen ? null : c.companyId)} data-testid={`row-readiness-${c.companyId}`}>
                        <TableCell className="text-muted-foreground">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-medium">
                          {c.name}
                          <span className="block text-[11px] text-muted-foreground font-mono">acct {c.iAccount} · tariff {c.iTariff ?? "—"}</span>
                        </TableCell>
                        {(["collection", "repository", "rating", "snapshots", "reconciliation", "invoice"] as const).map(col => {
                          const m = MARK[c.columns[col]];
                          return <TableCell key={col} className={`text-center text-lg ${m.cls}`} title={m.title}>{m.glyph}</TableCell>;
                        })}
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {usd(c.amounts.platform)} / {c.amounts.reference == null ? "—" : usd(c.amounts.reference)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${ACTION[c.action].cls}`}>{ACTION[c.action].label}</Badge>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" disabled={!canRate || rate.isPending} onClick={() => rate.mutate(c)}
                                    title="Rate this period from the CDRs already stored — no Sippy fetch" data-testid={`button-rate-${c.companyId}`}>
                              <Play className="h-3.5 w-3.5 text-blue-400" />
                            </Button>
                            <Button variant="ghost" size="sm" disabled={!canGenerate || generate.isPending} onClick={() => generate.mutate(c)}
                                    title="Generate a DRAFT through the full billing chain" data-testid={`button-generate-${c.companyId}`}>
                              <FileText className="h-3.5 w-3.5 text-emerald-400" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>,
                      isOpen ? (
                        <TableRow key={`${c.companyId}-detail`} className="bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={10}>
                            <div className="py-2 space-y-3">
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                                {[
                                  ["Days collected", `${c.counts.days - c.counts.uncovered} / ${c.counts.days}`],
                                  ["Stored calls", c.counts.calls.toLocaleString()],
                                  ["Verified", c.counts.verified.toLocaleString()],
                                  ["Snapshotted", c.counts.snapshotted.toLocaleString()],
                                  ["Invoice", c.invoice ? `${c.invoice.invoiceNumber} (${c.invoice.status})` : "none"],
                                ].map(([k, v]) => (
                                  <div key={k}><span className="text-muted-foreground">{k}</span><p className="font-mono tabular-nums">{v}</p></div>
                                ))}
                              </div>
                              {c.blockers.length === 0 ? (
                                <p className="text-sm text-emerald-400">Nothing blocks this customer.</p>
                              ) : (
                                <ol className="space-y-1.5">
                                  {c.blockers.map((b, i) => (
                                    <li key={b.code} className="flex gap-2 text-sm">
                                      <Badge variant="outline" className="text-[10px] shrink-0 h-5">{i === 0 ? "first" : STAGE_LABEL[b.stage] ?? b.stage}</Badge>
                                      <span><span className="font-medium">{STAGE_LABEL[b.stage] ?? b.stage}:</span> {b.detail}</span>
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null,
                    ];
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        ✓ complete · ⚠ partial · ✕ missing · — nothing here and not a fault. Rate runs from the repository only.
        Generate produces a DRAFT through every gate; nothing is sent from this page.
        {data ? ` Assessed ${new Date(data.generatedAt).toLocaleString()}.` : ""}
      </p>
    </div>
  );
}
