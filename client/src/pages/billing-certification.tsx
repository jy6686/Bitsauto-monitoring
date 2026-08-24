/**
 * Billing Certification Center
 *
 * The screen Finance sees before an invoice exists. It answers one question —
 * is this billing period fit to invoice — and shows the evidence behind the
 * answer rather than a bare verdict.
 *
 * Every count opens the calls behind it, grouped by destination and prefix,
 * because that is the shape of the remedy: "8 calls to 92312 have no rate" can
 * be acted on, a list of call ids cannot.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldCheck, AlertTriangle, XCircle, CheckCircle2, RefreshCw, Play,
  FileText, History, Layers, ChevronRight,
} from "lucide-react";

interface SippyAccount {
  iAccount: number; displayName: string; companyName: string | null; billingCycle: string | null;
}
interface Certification {
  state: 'certified' | 'exceptions' | 'uncertified';
  run: any | null;
  reasons: string[];
  counts?: { total: number; verified: number; unrated: number; missingRate: number; discrepancies: number; totalDelta: number };
}

function lastFullMonth() {
  const n = new Date();
  const s = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1));
  const e = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0));
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}

const fmtNum = (n: any) => (n == null ? "—" : Number(n).toLocaleString());
const fmtMoney = (n: any) => (n == null ? "—" : Number(n).toFixed(6));

export default function BillingCertificationPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const period = lastFullMonth();

  const [iAccount,    setIAccount]    = useState<string>("");
  const [iTariff,     setITariff]     = useState<string>("");
  const [periodStart, setPeriodStart] = useState(period.start);
  const [periodEnd,   setPeriodEnd]   = useState(period.end);
  const [drill,       setDrill]       = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [recertReason,   setRecertReason]   = useState("");

  const { data: accountsData } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ["/api/invoices/sippy-accounts"],
    queryFn: () => apiRequest("GET", "/api/invoices/sippy-accounts").then(r => r.json()),
    staleTime: 60_000,
  });
  const accounts = accountsData?.accounts ?? [];
  const account  = accounts.find(a => String(a.iAccount) === iAccount);

  const ready = Boolean(iTariff && periodStart && periodEnd);
  const qs = `iTariff=${encodeURIComponent(iTariff)}&periodStart=${periodStart}&periodEnd=${periodEnd}`;

  const { data: cert, isFetching, refetch } = useQuery<Certification>({
    queryKey: ["/api/finance/certification", iTariff, periodStart, periodEnd],
    queryFn: () => apiRequest("GET", `/api/finance/certification?${qs}`).then(r => r.json()),
    enabled: ready,
  });

  const { data: exceptions } = useQuery<any>({
    queryKey: ["/api/finance/certification/exceptions", iTariff, periodStart, periodEnd, drill],
    queryFn: () => apiRequest("GET", `/api/finance/certification/exceptions?${qs}&type=${drill}`).then(r => r.json()),
    enabled: ready && drill != null,
  });

  const { data: history = [] } = useQuery<any[]>({
    queryKey: ["/api/finance/verification-runs", iTariff],
    queryFn: () => apiRequest("GET", `/api/finance/verification-runs?iTariff=${encodeURIComponent(iTariff)}&limit=10`).then(r => r.json()),
    enabled: ready,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/invoices/pipeline-run", {
        iAccount: iAccount ? Number(iAccount) : undefined,
        iTariff, periodStart, periodEnd,
        customerName: account?.displayName ?? "",
        overrideReason: overrideReason.trim() || undefined,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Generation refused");
      return body;
    },
    onSuccess: (d: any) => {
      toast({ title: `Invoice ${d.invoice?.invoiceNumber} generated`, description: `${d.invoice?.lineCount ?? 0} line item(s).` });
      setOverrideReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      refetch();
    },
    onError: (e: any) => toast({ title: "Invoice not generated", description: e.message, variant: "destructive" }),
  });

  const recertify = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/finance/recertify", {
        iAccount: iAccount ? Number(iAccount) : undefined,
        iTariff, periodStart, periodEnd, reason: recertReason.trim(),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Re-certification refused");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Period re-certified", description: "Previous certification superseded and kept for audit." });
      setRecertReason("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/finance/verification-runs"] });
    },
    onError: (e: any) => toast({ title: "Re-certification refused", description: e.message, variant: "destructive" }),
  });

  const c = cert?.counts;
  const state = cert?.state;
  const stateBadge = state === 'certified'
    ? <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/30"><CheckCircle2 className="w-3 h-3" />Certified</Badge>
    : state === 'exceptions'
      ? <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-500 border-amber-500/30"><AlertTriangle className="w-3 h-3" />Exceptions</Badge>
      : <Badge variant="outline" className="gap-1 bg-red-500/10 text-red-500 border-red-500/30"><XCircle className="w-3 h-3" />Uncertified</Badge>;

  const canGenerate = state === 'certified' || (state === 'exceptions' && overrideReason.trim().length > 0);

  const metric = (label: string, value: any, type?: string, warn?: boolean) => (
    <button
      key={label}
      disabled={!type}
      onClick={() => type && setDrill(drill === type ? null : type)}
      data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className={`text-left rounded-md border px-3 py-2 transition-colors ${
        type ? "cursor-pointer hover:bg-muted/50" : "cursor-default"
      } ${warn ? "border-amber-500/40 bg-amber-500/5" : "border-border/60"} ${
        drill === type ? "ring-1 ring-primary" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {label}{type && <ChevronRight className="w-2.5 h-2.5" />}
      </div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </button>
  );

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto" data-testid="billing-certification-page">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Billing Certification Center
        </h1>
        <p className="text-muted-foreground mt-1">
          Whether a billing period is fit to invoice, and the evidence behind the answer.
          An invoice is generated from here, not before.
        </p>
      </div>

      {/* Period selection */}
      <Card>
        <CardContent className="pt-4 pb-4 grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Client</Label>
            <Select value={iAccount} onValueChange={setIAccount}>
              <SelectTrigger data-testid="select-client"><SelectValue placeholder="Select a client" /></SelectTrigger>
              <SelectContent>
                {accounts.map(a => (
                  <SelectItem key={a.iAccount} value={String(a.iAccount)}>{a.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tariff</Label>
            <Input value={iTariff} onChange={e => setITariff(e.target.value)}
              placeholder="e.g. 33" data-testid="input-tariff" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Period start</Label>
            <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} data-testid="input-period-start" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Period end</Label>
            <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} data-testid="input-period-end" />
          </div>
        </CardContent>
      </Card>

      {!ready && (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
          Choose a client, tariff and period to see its certification.
        </CardContent></Card>
      )}

      {ready && (
        <>
          {/* Verdict */}
          <Card className={
            state === 'certified' ? "border-emerald-500/30" :
            state === 'exceptions' ? "border-amber-500/30" : "border-red-500/30"
          }>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                {account?.displayName ?? "—"} · {periodStart} → {periodEnd}
                {stateBadge}
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />Refresh
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pb-4">
              {(cert?.reasons?.length ?? 0) > 0 && (
                <ul className="text-sm space-y-1">
                  {cert!.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-amber-500">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{r}
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {metric("Calls verified", fmtNum(c?.total))}
                {metric("Priced exactly", fmtNum(c?.verified))}
                {metric("Missing rate", fmtNum(c?.missingRate), "missing_rate", (c?.missingRate ?? 0) > 0)}
                {metric("Unrated", fmtNum(c?.unrated), "unrated", (c?.unrated ?? 0) > 0)}
                {metric("Priced differently", fmtNum(c?.discrepancies), "differing", (c?.discrepancies ?? 0) > 0)}
                {metric("Total difference", fmtMoney(c?.totalDelta))}
              </div>

              {cert?.run && (
                <div className="text-xs text-muted-foreground flex gap-4 flex-wrap">
                  <span>Run <span className="font-mono text-foreground">#{cert.run.id}</span></span>
                  <span>Engine <span className="font-mono text-foreground">{cert.run.engine_version ?? "—"}</span></span>
                  <span>Tariff versions <span className="font-mono text-foreground">{cert.run.tariff_versions ?? "—"}</span></span>
                  <span>Snapshots <span className="font-mono text-foreground">{fmtNum(cert.run.snapshots_created)}</span></span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Drill-down */}
          {drill && (
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  {drill === 'unrated' ? "Calls with no tariff version"
                    : drill === 'missing_rate' ? "Calls with no matching rate"
                    : "Calls priced differently from the switch"}
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setDrill(null)}>Close</Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Destination</TableHead>
                        <TableHead>Prefix</TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                        <TableHead className="text-right">Seconds</TableHead>
                        <TableHead className="text-right">Switch</TableHead>
                        <TableHead className="text-right">Verified</TableHead>
                        <TableHead>What to do</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(exceptions?.groups ?? []).map((g: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{g.destination}</TableCell>
                          <TableCell className="font-mono text-xs">{g.prefix}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(g.calls)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(g.seconds)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(g.switch_cost)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(g.verified_cost)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{g.remedy}</TableCell>
                        </TableRow>
                      ))}
                      {(exceptions?.groups ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                          Nothing in this category.
                        </TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Decision */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm">Certification decision</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pb-4">
              {state === 'uncertified' && (
                <p className="text-sm text-red-500">
                  Nothing has been verified for this period. Reconcile it before invoicing — the nightly
                  run covers yesterday, so a past period needs an explicit re-certification.
                </p>
              )}
              {state === 'exceptions' && (
                <div className="space-y-2">
                  <Label className="text-xs">
                    Override reason — required to invoice a period with exceptions, recorded against the invoice with your name
                  </Label>
                  <Textarea rows={2} value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                    placeholder="e.g. 35 unrated calls accepted; rate coverage scheduled for next cycle"
                    data-testid="input-override-reason" />
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => generate.mutate()} disabled={!canGenerate || generate.isPending}
                  data-testid="button-generate-certified">
                  {generate.isPending
                    ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Generating…</>
                    : <><FileText className="w-4 h-4 mr-2" />Generate Invoice</>}
                </Button>
                {!canGenerate && state === 'exceptions' && (
                  <span className="text-xs text-muted-foreground self-center">
                    Enter an override reason, or fix the exceptions and re-certify.
                  </span>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label className="text-xs">
                  Re-certify this period — discards the derived rating and re-rates from stored call
                  evidence. The previous certification is superseded, never deleted.
                </Label>
                <div className="flex gap-2 flex-wrap">
                  <Input value={recertReason} onChange={e => setRecertReason(e.target.value)}
                    placeholder="Reason (required), e.g. rate added for 92312"
                    className="max-w-md" data-testid="input-recert-reason" />
                  <Button variant="outline" onClick={() => recertify.mutate()}
                    disabled={!recertReason.trim() || recertify.isPending}
                    data-testid="button-recertify">
                    {recertify.isPending
                      ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Re-certifying…</>
                      : <><Play className="w-4 h-4 mr-2" />Re-certify</>}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* History */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4" />Certification history</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead className="text-right">Verified</TableHead>
                      <TableHead className="text-right">Excluded</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((r: any) => (
                      <TableRow key={r.id} className={r.superseded_at ? "opacity-60" : ""}>
                        <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                        <TableCell className="text-xs">{r.period_start} → {r.period_end}</TableCell>
                        <TableCell className="text-xs">{r.started_at ? new Date(r.started_at).toLocaleString() : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(r.verified)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(r.excluded)}</TableCell>
                        <TableCell>
                          {r.superseded_at
                            ? <Badge variant="outline" className="text-xs">Superseded</Badge>
                            : r.status === 'warning'
                              ? <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/30">Exceptions</Badge>
                              : <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Clean</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {history.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                        No verification run recorded for this tariff yet.
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
