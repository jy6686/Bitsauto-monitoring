import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import {
  Shield, FileText, Activity, Users, Mail, BarChart3,
  CheckCircle2, AlertTriangle, Download, Loader2, TrendingUp,
} from "lucide-react";

interface DisputePackage {
  meta:    { clientName: string; billingPeriod: string; generatedAt: string; evidenceLayers: string[] };
  invoice?: { id: number; status: string; totalAmountUsd?: number; totalDurationSec?: number; issuedAt?: string };
  dmrSummary?: { datesCovered: string[]; totalSippyDurationMin: number; totalSippyAmount: number; clientRowCount: number; verifiedRows: number; driftedRows: number; version: number };
  reconciliation?: { id: number; billingPeriod: string; clientAmountUsd?: number; bitsautoAmountUsd?: number; deltaAmountUsd?: number; deltaPct?: number; severity: string; status: string; version: number };
  commercialNotices?: { id: number; type: string; subject?: string; status: string; sentAt?: string; openedAt?: string | null; acknowledgedAt?: string | null; recipients: number }[];
  marginsOnRecord?: { date?: string; revenueUsd?: number; marginUsd?: number; marginPct?: number };
  summary: { invoiceFound: boolean; dmrDatesFound: number; reconciliationFound: boolean; noticesSent: number; noticesAcknowledged: number; overallConfidence: string; statement: string };
}

const schema = z.object({
  clientName:    z.string().min(1, 'Client name required'),
  billingPeriod: z.string().regex(/^\d{4}-\d{2}$/, 'Format: YYYY-MM'),
});

const CONFIDENCE_CFG = {
  high:   { color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', label: 'High' },
  medium: { color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',       label: 'Medium' },
  low:    { color: 'text-red-400 bg-red-400/10 border-red-400/30',             label: 'Low' },
};

function fmt(v?: number | null, d = 2) { return v == null ? '—' : v.toFixed(d); }

function EvidenceBadge({ present, label }: { present: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${present ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' : 'text-muted-foreground bg-muted/30 border-transparent'}`}>
      {present ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {label}
    </div>
  );
}

export default function DisputeDefensePage() {
  const { toast } = useToast();
  const [pkg, setPkg] = useState<DisputePackage | null>(null);

  const form = useForm({ resolver: zodResolver(schema), defaultValues: { clientName: '', billingPeriod: new Date().toISOString().slice(0, 7) } });

  const generateMutation = useMutation({
    mutationFn: (data: z.infer<typeof schema>) =>
      apiRequest("POST", "/api/dispute-defense/generate", data).then(r => r.json()),
    onSuccess: (data) => { setPkg(data); },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  function downloadJSON() {
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `dispute-defense_${pkg.meta.clientName.replace(/\s+/g, '-')}_${pkg.meta.billingPeriod}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Dispute Defense Package
          </h1>
          <p className="text-muted-foreground mt-1">
            Assemble a complete evidence bundle from all finance truth layers for any client dispute
          </p>
        </div>
        {pkg && (
          <Button data-testid="button-export-json" variant="outline" onClick={downloadJSON}>
            <Download className="h-4 w-4 mr-2" />
            Export JSON
          </Button>
        )}
      </div>

      {/* Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Generate Evidence Package</CardTitle>
          <CardDescription className="text-xs">
            Enter the client name and billing period. BitsAuto will pull all available
            finance truth layers: invoice, DMR, reconciliation, tariff snapshots, and commercial notices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => generateMutation.mutate(d))} className="flex gap-3 flex-wrap items-end">
              <FormField control={form.control} name="clientName" render={({ field }) => (
                <FormItem className="flex-1 min-w-48">
                  <FormLabel>Client Name</FormLabel>
                  <FormControl>
                    <Input data-testid="input-client-name" placeholder="Acme Telecom Ltd" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="billingPeriod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Billing Period</FormLabel>
                  <FormControl>
                    <Input data-testid="input-billing-period" type="month" {...field} className="w-40" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button data-testid="button-generate" type="submit" disabled={generateMutation.isPending}>
                {generateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Assembling…</> : 'Generate Package'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Evidence package */}
      {pkg && (
        <div className="space-y-4">
          {/* Summary */}
          <Card className={`border-2 ${pkg.summary.overallConfidence === 'high' ? 'border-emerald-500/30' : pkg.summary.overallConfidence === 'medium' ? 'border-amber-500/30' : 'border-red-500/30'}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Evidence Summary — {pkg.meta.clientName} · {pkg.meta.billingPeriod}
                </CardTitle>
                <Badge variant="outline" className={`${CONFIDENCE_CFG[pkg.summary.overallConfidence as keyof typeof CONFIDENCE_CFG]?.color}`}>
                  {CONFIDENCE_CFG[pkg.summary.overallConfidence as keyof typeof CONFIDENCE_CFG]?.label} Confidence
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{pkg.summary.statement}</p>
              <div className="flex flex-wrap gap-2">
                <EvidenceBadge present={pkg.summary.invoiceFound}        label="Invoice" />
                <EvidenceBadge present={pkg.summary.dmrDatesFound > 0}  label={`DMR (${pkg.summary.dmrDatesFound} days)`} />
                <EvidenceBadge present={pkg.summary.reconciliationFound} label="Reconciliation" />
                <EvidenceBadge present={pkg.summary.noticesSent > 0}     label={`Notices (${pkg.summary.noticesSent} sent)`} />
                <EvidenceBadge present={pkg.summary.noticesAcknowledged > 0} label={`Acknowledged (${pkg.summary.noticesAcknowledged})`} />
                <EvidenceBadge present={!!pkg.marginsOnRecord}           label="Margin Record" />
              </div>
            </CardContent>
          </Card>

          {/* Invoice */}
          {pkg.invoice && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-400" />Invoice
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">ID</dt><dd className="font-mono">#{pkg.invoice.id}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Status</dt><dd><Badge variant="outline" className="text-xs">{pkg.invoice.status}</Badge></dd></div>
                  <div><dt className="text-xs text-muted-foreground">Amount</dt><dd className="font-semibold text-emerald-400">${fmt(pkg.invoice.totalAmountUsd)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Issued</dt><dd>{pkg.invoice.issuedAt ? new Date(pkg.invoice.issuedAt).toLocaleDateString() : '—'}</dd></div>
                </dl>
              </CardContent>
            </Card>
          )}

          {/* DMR */}
          {pkg.dmrSummary && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-purple-400" />
                  Sippy Operational Records (DMR)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Days Covered</dt><dd className="font-semibold">{pkg.dmrSummary.datesCovered.length}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Sippy Duration</dt><dd>{pkg.dmrSummary.totalSippyDurationMin.toLocaleString()} min</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Sippy Amount</dt><dd className="text-blue-400 font-semibold">${fmt(pkg.dmrSummary.totalSippyAmount)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Verified / Drifted</dt>
                    <dd>
                      <span className="text-emerald-400">{pkg.dmrSummary.verifiedRows}✓</span>
                      {' / '}
                      <span className="text-amber-400">{pkg.dmrSummary.driftedRows}△</span>
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground mt-3">
                  Dates: {pkg.dmrSummary.datesCovered.slice(0, 10).join(', ')}{pkg.dmrSummary.datesCovered.length > 10 ? ` + ${pkg.dmrSummary.datesCovered.length - 10} more` : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Reconciliation */}
          {pkg.reconciliation && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-amber-400" />
                  Client Revenue Reconciliation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Client Reported</dt><dd>${fmt(pkg.reconciliation.clientAmountUsd)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">BitsAuto Invoice</dt><dd>${fmt(pkg.reconciliation.bitsautoAmountUsd)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Delta</dt>
                    <dd className={pkg.reconciliation.deltaAmountUsd && Math.abs(pkg.reconciliation.deltaAmountUsd) > 10 ? 'text-red-400' : 'text-emerald-400'}>
                      ${fmt(pkg.reconciliation.deltaAmountUsd)} ({fmt(pkg.reconciliation.deltaPct, 1)}%)
                    </dd>
                  </div>
                  <div><dt className="text-xs text-muted-foreground">Severity</dt>
                    <dd><Badge variant="outline" className="text-xs">{pkg.reconciliation.severity}</Badge></dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}

          {/* Commercial notices */}
          {pkg.commercialNotices && pkg.commercialNotices.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Mail className="h-4 w-4 text-sky-400" />
                  Commercial Notices ({pkg.commercialNotices.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {pkg.commercialNotices.map(n => (
                    <div key={n.id} className="flex items-center justify-between text-sm border rounded px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground">#{n.id}</span>
                        <span className="font-medium">{n.subject ?? n.type}</span>
                        <Badge variant="outline" className="text-xs">{n.status}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {n.sentAt && <span>{new Date(n.sentAt).toLocaleDateString()}</span>}
                        {n.openedAt && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Opened</span>}
                        {n.acknowledgedAt && <span className="text-purple-400 flex items-center gap-1"><Shield className="h-3 w-3" />Acknowledged</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Margin record */}
          {pkg.marginsOnRecord && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  Margin on Record
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Revenue</dt><dd className="text-blue-400">${fmt(pkg.marginsOnRecord.revenueUsd)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Margin</dt><dd className={pkg.marginsOnRecord.marginUsd && pkg.marginsOnRecord.marginUsd < 0 ? 'text-red-400' : 'text-emerald-400'}>${fmt(pkg.marginsOnRecord.marginUsd)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Margin %</dt><dd>{fmt(pkg.marginsOnRecord.marginPct, 1)}%</dd></div>
                </dl>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Package generated at {new Date(pkg.meta.generatedAt).toLocaleString()} · Evidence layers: {pkg.meta.evidenceLayers.join(', ') || 'none found'}
          </p>
        </div>
      )}
    </div>
  );
}
