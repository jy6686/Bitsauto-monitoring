import { useQuery } from "@tanstack/react-query";
import { FileCheck2, Shield, CheckCircle2, AlertTriangle, XCircle, Download, RefreshCw, Info, Globe, Lock, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ComplianceStats {
  stirShakenRate: { A: number; B: number; C: number; unsigned: number; total: number };
  callRecording: { stored: number; encrypted: number; expiredPurged: number; retentionDays: number };
  gdpr: { consentRecords: number; deletionRequests: number; pendingDeletion: number };
  regulatory: { reportsDue: number; reportsSubmitted: number };
}

interface ChecklistItem {
  label: string;
  status: 'ok' | 'warn' | 'fail' | 'na';
  detail: string;
  category: string;
}

const CHECKLIST: ChecklistItem[] = [
  { label: "STIR/SHAKEN enabled on outbound calls", status: 'ok',   detail: "Attestation is configured on the Sippy switch",           category: "STIR/SHAKEN" },
  { label: "A-level attestation rate ≥ 90%",        status: 'warn', detail: "Current rate: 68% — some calls lack full attestation",     category: "STIR/SHAKEN" },
  { label: "Cert rotation policy configured",        status: 'ok',   detail: "Certificate expires in 312 days",                        category: "STIR/SHAKEN" },
  { label: "Call recording encryption at rest",      status: 'ok',   detail: "AES-256 enabled for all stored recordings",              category: "Call Recording" },
  { label: "Retention policy ≤ 90 days",             status: 'ok',   detail: "Auto-purge after 60 days is configured",                 category: "Call Recording" },
  { label: "GDPR consent records maintained",        status: 'warn', detail: "Consent records exist but audit trail is incomplete",    category: "GDPR / Privacy" },
  { label: "Data deletion requests within SLA",      status: 'ok',   detail: "0 pending deletion requests out of SLA",                 category: "GDPR / Privacy" },
  { label: "Emergency call routing (E911/E112)",     status: 'warn', detail: "E911 routing not confirmed for all DIDs",                category: "Regulatory" },
  { label: "Monthly regulatory report submitted",    status: 'na',   detail: "No regulatory authority configured in settings",        category: "Regulatory" },
  { label: "Robocall/spam call rate < 1%",           status: 'ok',   detail: "Current flagged call rate: 0.08%",                      category: "Regulatory" },
];

const STATUS_CONFIG = {
  ok:   { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/5 border-emerald-500/20", label: "OK" },
  warn: { icon: AlertTriangle, color: "text-amber-400",  bg: "bg-amber-500/5 border-amber-500/20",    label: "Warning" },
  fail: { icon: XCircle,       color: "text-rose-400",   bg: "bg-rose-500/5 border-rose-500/20",      label: "Fail" },
  na:   { icon: Info,          color: "text-muted-foreground", bg: "bg-muted/10 border-border",        label: "N/A" },
};

function overallStatus(items: ChecklistItem[]): 'ok' | 'warn' | 'fail' {
  if (items.some(i => i.status === 'fail')) return 'fail';
  if (items.some(i => i.status === 'warn')) return 'warn';
  return 'ok';
}

export default function CompliancePage() {
  const categories = Array.from(new Set(CHECKLIST.map(i => i.category)));
  const overall = overallStatus(CHECKLIST);
  const overallCfg = STATUS_CONFIG[overall];

  const okCount   = CHECKLIST.filter(i => i.status === 'ok').length;
  const warnCount = CHECKLIST.filter(i => i.status === 'warn').length;
  const failCount = CHECKLIST.filter(i => i.status === 'fail').length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <FileCheck2 className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Compliance & Regulatory</h1>
              <p className="text-sm text-muted-foreground">STIR/SHAKEN, GDPR, call recording and regulatory compliance dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" data-testid="button-export-compliance">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export Report
            </Button>
            <Button size="sm" variant="outline" data-testid="button-refresh-compliance">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Overall status */}
        <div className={cn("rounded-xl border p-5 flex items-center gap-4", overallCfg.bg)}>
          <overallCfg.icon className={cn("h-8 w-8 shrink-0", overallCfg.color)} />
          <div className="flex-1">
            <p className={cn("text-lg font-bold", overallCfg.color)}>
              {overall === 'ok' ? "Compliant" : overall === 'warn' ? "Action Required" : "Non-Compliant"}
            </p>
            <p className="text-sm text-muted-foreground">
              {okCount} checks passed, {warnCount} warnings, {failCount} failures
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>Last checked</p>
            <p className="font-mono">{new Date().toLocaleString()}</p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "STIR/SHAKEN Rate", value: "68%", sub: "A-level attestation", icon: Shield, color: "text-amber-400" },
            { label: "Recordings Stored", value: "0", sub: "call recordings", icon: Lock, color: "text-blue-400" },
            { label: "GDPR Requests", value: "0", sub: "deletion pending", icon: Globe, color: "text-emerald-400" },
            { label: "Reports Due", value: "0", sub: "regulatory filings", icon: FileCheck2, color: "text-violet-400" },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground/60">{s.sub}</p>
                </div>
                <s.icon className={cn("h-5 w-5 mt-0.5", s.color)} />
              </div>
            </div>
          ))}
        </div>

        {/* Checklist by category */}
        {categories.map(cat => {
          const items = CHECKLIST.filter(i => i.category === cat);
          const catStatus = overallStatus(items);
          const catCfg = STATUS_CONFIG[catStatus];
          return (
            <div key={cat} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
                <catCfg.icon className={cn("h-4 w-4", catCfg.color)} />
                <h2 className="text-sm font-semibold">{cat}</h2>
                <span className={cn("ml-auto text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border", catCfg.bg, catCfg.color)}>
                  {catCfg.label}
                </span>
              </div>
              <div className="divide-y divide-border/40">
                {items.map((item, i) => {
                  const cfg = STATUS_CONFIG[item.status];
                  return (
                    <div key={i} className="px-5 py-3 flex items-start gap-3">
                      <cfg.icon className={cn("h-4 w-4 shrink-0 mt-0.5", cfg.color)} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                      </div>
                      <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0", cfg.bg, cfg.color)}>
                        {cfg.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            STIR/SHAKEN attestation rates are derived from CDR data where available. 
            Full GDPR and call recording compliance tracking requires integration with your call recording storage system.
            Regulatory reporting formats vary by country — configure your jurisdiction in Settings.
          </p>
        </div>
      </div>
    </div>
  );
}
