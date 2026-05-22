import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlaskConical, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  Activity, BarChart2, Zap, TrendingDown, Shield, GitBranch, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────
type Status = 'pass' | 'warn' | 'fail';

type ValidationResponse = {
  generatedAt: string;
  overallStatus: Status;
  telemetry: {
    cdrCacheSize: number;
    cdrCacheAgeMinutes: number | null;
    lastRefreshAt: string | null;
    oldestRecord: string | null;
    newestRecord: string | null;
    windowCdrCount: number;
    checks: Array<{ check: string; status: Status; detail: string }>;
    status: Status;
  };
  qScore: {
    vendors: Array<{
      vendor: string; callCount: number; q: number; interpretation: string;
      components: {
        asr: { value: number; contribution: number; status: Status };
        ner: { value: number; contribution: number; status: Status };
        fas: { value: number; fasScore: number; contribution: number; status: Status };
        pdd: { value: number; score: number; contribution: number; status: Status };
      };
    }>;
    vendorCount: number;
    status: Status;
  };
  recommendations: {
    count: number;
    breakdown: { immediate: number; today: number; monitor: number; promote: number };
    items: Array<{ vendor: string; type: string; urgency: string; title: string; confidence: number; ruleDescription: string }>;
    status: Status;
  };
  degradation: {
    alertCount: number;
    severity: { critical: number; warning: number; info: number };
    alerts: Array<{ vendor: string; severity: 'critical'|'warning'|'info'; deltaQ: number; curQ: number; prevQ: number; signals: string[] }>;
    status: Status;
  };
  incidents: {
    activeCount: number;
    active: Array<{ id: number; entityName: string | null; entityId: string; incidentType: string; severity: string; title: string; confidence: number; openedAt: string }>;
    recentlyClosed: Array<{ id: number; entityName: string | null; entityId: string; incidentType: string; severity: string; title: string; resolvedAt: string | null }>;
    status: Status;
  };
  crossValidation: {
    assertions: Array<{ assertion: string; status: Status; detail: string }>;
    passed: number;
    warned: number;
    failed: number;
    status: Status;
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const statusIcon = (s: Status, sz = "w-3.5 h-3.5") =>
  s === 'pass' ? <CheckCircle2 className={cn(sz, "text-emerald-400")} />
  : s === 'warn' ? <AlertTriangle className={cn(sz, "text-amber-400")} />
  : <XCircle className={cn(sz, "text-rose-400")} />;

const statusBadge = (s: Status, label?: string) => (
  <span className={cn(
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border",
    s === 'pass' ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
    : s === 'warn' ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
    : "bg-rose-500/15 border-rose-500/30 text-rose-300"
  )}>
    {statusIcon(s, "w-2.5 h-2.5")}
    {label ?? (s === 'pass' ? 'Pass' : s === 'warn' ? 'Warn' : 'Fail')}
  </span>
);

const statusRowCls = (s: Status) =>
  s === 'pass' ? 'text-emerald-400' : s === 'warn' ? 'text-amber-400' : 'text-rose-400';

const sectionBorderCls = (s: Status) =>
  s === 'pass' ? 'border-emerald-500/20' : s === 'warn' ? 'border-amber-500/25' : 'border-rose-500/30';

const typeCfg: Record<string, { label: string; cls: string }> = {
  INVESTIGATE:     { label: 'Investigate',     cls: 'bg-rose-500/20 border-rose-500/40 text-rose-300'    },
  FAS_ALERT:       { label: 'FAS Alert',       cls: 'bg-rose-500/15 border-rose-500/30 text-rose-300'    },
  REDUCE_PRIORITY: { label: 'Reduce Priority', cls: 'bg-amber-500/15 border-amber-500/30 text-amber-300' },
  MONITOR:         { label: 'Monitor',         cls: 'bg-sky-500/10 border-sky-500/20 text-sky-300'       },
  PROMOTE:         { label: 'Promote',         cls: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' },
};

// ── Section card wrapper ───────────────────────────────────────────────────────
function SectionCard({ title, icon, status, children }: {
  title: string; icon: React.ReactNode; status: Status; children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border bg-card/50 overflow-hidden", sectionBorderCls(status))}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-muted/10">
        <span className={statusRowCls(status)}>{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
        <span className="ml-auto">{statusBadge(status)}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IntelligenceValidationPage() {
  const qc = useQueryClient();
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);

  const { data, isLoading, dataUpdatedAt } = useQuery<ValidationResponse>({
    queryKey: ['/api/intelligence/validation'],
    queryFn: async () => {
      const r = await fetch('/api/intelligence/validation');
      if (!r.ok) throw new Error('Failed to fetch validation data');
      return r.json();
    },
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });

  const overall = data?.overallStatus ?? 'pass';

  return (
    <div className="min-h-screen bg-background">
      {/* ── Page header ── */}
      <div className="border-b border-border/40 bg-card/30">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <FlaskConical className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">Intelligence Validation Console</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Passive observer · Real traffic only · No synthetic data
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {data && (
                <span className="text-[10px] text-muted-foreground">
                  updated {new Date(data.generatedAt).toLocaleTimeString()}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => qc.invalidateQueries({ queryKey: ['/api/intelligence/validation'] })}
                data-testid="btn-refresh-validation"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Overall status banner */}
          <div className={cn(
            "mt-4 flex items-center gap-3 px-4 py-2.5 rounded-lg border",
            overall === 'pass' ? "bg-emerald-500/5 border-emerald-500/25" :
            overall === 'warn' ? "bg-amber-500/5 border-amber-500/25" :
            "bg-rose-500/5 border-rose-500/30"
          )}>
            {statusIcon(overall, "w-4 h-4")}
            <span className={cn("text-sm font-semibold", statusRowCls(overall))}>
              {overall === 'pass' ? 'All Intelligence Engines Valid'
              : overall === 'warn' ? 'Validation Warnings Detected'
              : 'Validation Failures Detected'}
            </span>
            {data && (
              <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>{data.qScore.vendorCount} vendors</span>
                <span>{data.telemetry.cdrCacheSize.toLocaleString()} CDRs</span>
                <span>{data.crossValidation.passed}/{data.crossValidation.assertions.length} assertions pass</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" /> Running intelligence validation…
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground py-12 text-center">No validation data available.</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

            {/* ── 1. Telemetry Integrity ── */}
            <SectionCard title="Telemetry Integrity" icon={<Activity className="w-4 h-4" />} status={data.telemetry.status}>
              <div className="space-y-2.5">
                {data.telemetry.checks.map((c) => (
                  <div key={c.check} className="flex items-center gap-2.5">
                    {statusIcon(c.status)}
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-foreground/90">{c.check}</span>
                      <span className="ml-2 text-[10px] text-muted-foreground">{c.detail}</span>
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-border/30 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                  <div>
                    <span className="text-muted-foreground/60">Cache total</span>
                    <span className="ml-1.5 font-mono text-foreground/70">{data.telemetry.cdrCacheSize.toLocaleString()} records</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground/60">60m window</span>
                    <span className="ml-1.5 font-mono text-foreground/70">{data.telemetry.windowCdrCount} CDRs</span>
                  </div>
                  {data.telemetry.oldestRecord && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground/60">Cache range</span>
                      <span className="ml-1.5 font-mono text-foreground/70">
                        {new Date(data.telemetry.oldestRecord).toLocaleString()} → {data.telemetry.newestRecord ? new Date(data.telemetry.newestRecord).toLocaleString() : '—'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* ── 2. Q-Score Decomposition ── */}
            <SectionCard title="Q-Score Decomposition" icon={<BarChart2 className="w-4 h-4" />} status={data.qScore.status}>
              {data.qScore.vendors.length === 0 ? (
                <p className="text-xs text-muted-foreground">No vendors with ≥5 calls in the last 60 minutes.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.qScore.vendors.map((v) => {
                    const isOpen = expandedVendor === v.vendor;
                    return (
                      <div key={v.vendor} className="rounded-lg border border-border/30 overflow-hidden">
                        <button
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/5 transition-colors"
                          onClick={() => setExpandedVendor(isOpen ? null : v.vendor)}
                          data-testid={`qscore-expand-${v.vendor}`}
                        >
                          <span className={cn("text-xs font-bold w-8 text-right flex-shrink-0 font-mono",
                            v.q < 25 ? 'text-rose-400' : v.q < 40 ? 'text-rose-300' : v.q < 55 ? 'text-amber-400' : v.q < 80 ? 'text-sky-400' : 'text-emerald-400')}>
                            Q{v.q}
                          </span>
                          <span className="text-xs font-medium text-foreground flex-1">{v.vendor}</span>
                          <span className="text-[10px] text-muted-foreground">{v.callCount} calls</span>
                          <span className="text-[10px] text-muted-foreground/60 ml-1">{v.interpretation}</span>
                          <ChevronDown className={cn("w-3 h-3 text-muted-foreground/50 flex-shrink-0 transition-transform", isOpen && "rotate-180")} />
                        </button>
                        {isOpen && (
                          <div className="border-t border-border/30 bg-muted/5">
                            <table className="w-full text-[10px]">
                              <thead>
                                <tr className="border-b border-border/20 bg-muted/10">
                                  <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Signal</th>
                                  <th className="text-center px-3 py-1.5 text-muted-foreground font-medium">Weight</th>
                                  <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Value</th>
                                  <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Score</th>
                                  <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">+Q pts</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/20">
                                <tr>
                                  <td className="px-3 py-1.5 font-mono font-semibold"><span className={statusRowCls(v.components.asr.status)}>ASR</span></td>
                                  <td className="px-3 py-1.5 text-center text-muted-foreground/60">40%</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{v.components.asr.value}%</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{v.components.asr.value.toFixed(0)}/100</td>
                                  <td className={cn("px-3 py-1.5 text-right font-mono font-bold", statusRowCls(v.components.asr.status))}>+{v.components.asr.contribution}</td>
                                </tr>
                                <tr>
                                  <td className="px-3 py-1.5 font-mono font-semibold"><span className={statusRowCls(v.components.ner.status)}>NER</span></td>
                                  <td className="px-3 py-1.5 text-center text-muted-foreground/60">30%</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{v.components.ner.value}%</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{v.components.ner.value.toFixed(0)}/100</td>
                                  <td className={cn("px-3 py-1.5 text-right font-mono font-bold", statusRowCls(v.components.ner.status))}>+{v.components.ner.contribution}</td>
                                </tr>
                                <tr>
                                  <td className="px-3 py-1.5 font-mono font-semibold"><span className={statusRowCls(v.components.fas.status)}>FAS</span></td>
                                  <td className="px-3 py-1.5 text-center text-muted-foreground/60">20%</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{v.components.fas.value}%</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{v.components.fas.fasScore}/100</td>
                                  <td className={cn("px-3 py-1.5 text-right font-mono font-bold", statusRowCls(v.components.fas.status))}>+{v.components.fas.contribution}</td>
                                </tr>
                                <tr>
                                  <td className="px-3 py-1.5 font-mono font-semibold"><span className={statusRowCls(v.components.pdd.status)}>PDD</span></td>
                                  <td className="px-3 py-1.5 text-center text-muted-foreground/60">10%</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{v.components.pdd.value}s</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{v.components.pdd.score}/100</td>
                                  <td className={cn("px-3 py-1.5 text-right font-mono font-bold", statusRowCls(v.components.pdd.status))}>+{v.components.pdd.contribution}</td>
                                </tr>
                                <tr className="bg-muted/10 border-t border-border/40">
                                  <td className="px-3 py-1.5 font-semibold text-foreground" colSpan={4}>Composite Q-Score</td>
                                  <td className={cn("px-3 py-1.5 text-right font-mono font-bold text-sm",
                                    v.q < 40 ? 'text-rose-400' : v.q < 60 ? 'text-amber-400' : 'text-emerald-400')}>
                                    Q{v.q}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            {/* ── 3. Recommendation Audit ── */}
            <SectionCard title="Recommendation Audit" icon={<Zap className="w-4 h-4" />} status={data.recommendations.status}>
              <div className="space-y-3">
                {/* Breakdown pills */}
                <div className="flex flex-wrap gap-1.5">
                  {data.recommendations.breakdown.immediate > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[9px] font-bold">
                      {data.recommendations.breakdown.immediate} immediate
                    </span>
                  )}
                  {data.recommendations.breakdown.today > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-bold">
                      {data.recommendations.breakdown.today} today
                    </span>
                  )}
                  {data.recommendations.breakdown.promote > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[9px] font-bold">
                      {data.recommendations.breakdown.promote} promote
                    </span>
                  )}
                  {data.recommendations.count === 0 && (
                    <span className="text-xs text-muted-foreground">No recommendations in current window</span>
                  )}
                </div>
                {/* Recommendation list */}
                {data.recommendations.items.length > 0 && (
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="bg-muted/20 border-b border-border/30">
                          <th className="text-left px-2.5 py-1.5 text-muted-foreground font-medium">Vendor</th>
                          <th className="text-left px-2.5 py-1.5 text-muted-foreground font-medium">Type</th>
                          <th className="text-right px-2.5 py-1.5 text-muted-foreground font-medium">Conf.</th>
                          <th className="text-left px-2.5 py-1.5 text-muted-foreground font-medium">Rule</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {data.recommendations.items.map((r, i) => {
                          const cfg = typeCfg[r.type] ?? { label: r.type, cls: 'bg-muted/10 border-muted text-muted-foreground' };
                          return (
                            <tr key={i} className="hover:bg-muted/5" data-testid={`rec-audit-${r.vendor}`}>
                              <td className="px-2.5 py-1.5 font-semibold text-foreground/90">{r.vendor}</td>
                              <td className="px-2.5 py-1.5">
                                <span className={cn("px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider", cfg.cls)}>
                                  {cfg.label}
                                </span>
                              </td>
                              <td className={cn("px-2.5 py-1.5 text-right font-mono font-bold",
                                r.confidence >= 80 ? 'text-emerald-400' : r.confidence >= 60 ? 'text-amber-400' : 'text-rose-400')}>
                                {r.confidence}%
                              </td>
                              <td className="px-2.5 py-1.5 text-muted-foreground font-mono">{r.ruleDescription}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* ── 4. Degradation Audit ── */}
            <SectionCard title="Degradation Audit" icon={<TrendingDown className="w-4 h-4" />} status={data.degradation.status}>
              <div className="space-y-2">
                <div className="flex gap-2 flex-wrap text-[10px] text-muted-foreground">
                  <span>{data.degradation.alertCount} alert{data.degradation.alertCount !== 1 ? 's' : ''} in 60m window</span>
                  {data.degradation.severity.critical > 0 && <span className="text-rose-400 font-semibold">{data.degradation.severity.critical} critical</span>}
                  {data.degradation.severity.warning > 0 && <span className="text-amber-400 font-semibold">{data.degradation.severity.warning} warning</span>}
                  {data.degradation.severity.info > 0 && <span className="text-sky-400">{data.degradation.severity.info} info</span>}
                </div>
                {data.degradation.alerts.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 py-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> No degradation detected in current comparison window
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {data.degradation.alerts.map((a) => (
                      <div key={a.vendor} className={cn(
                        "px-3 py-2 rounded-lg border",
                        a.severity === 'critical' ? 'border-rose-500/30 bg-rose-500/5'
                        : a.severity === 'warning' ? 'border-amber-500/20 bg-amber-500/5'
                        : 'border-sky-500/15 bg-sky-500/5'
                      )} data-testid={`degrad-audit-${a.vendor}`}>
                        <div className="flex items-center gap-2 mb-0.5">
                          {statusIcon(a.severity === 'critical' ? 'fail' : a.severity === 'warning' ? 'warn' : 'pass')}
                          <span className="text-xs font-bold text-foreground">{a.vendor}</span>
                          <span className={cn("ml-auto text-[10px] font-mono font-bold",
                            a.deltaQ < 0 ? 'text-rose-400' : 'text-emerald-400')}>
                            {a.deltaQ > 0 ? '+' : ''}{a.deltaQ} pts (Q{a.prevQ}→Q{a.curQ})
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {a.signals.map((sig, i) => (
                            <span key={i} className="text-[9px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                              {sig}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>

            {/* ── 5. Incident Attribution ── */}
            <SectionCard title="Incident Attribution" icon={<Shield className="w-4 h-4" />} status={data.incidents.status}>
              <div className="space-y-3">
                {data.incidents.activeCount === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 py-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> No active incidents
                  </div>
                ) : (
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 font-semibold">
                      Active ({data.incidents.activeCount})
                    </p>
                    <div className="space-y-1.5">
                      {data.incidents.active.map((inc) => (
                        <div key={inc.id} className={cn(
                          "px-3 py-2 rounded-lg border",
                          inc.severity === 'critical' ? 'border-rose-500/30 bg-rose-500/5'
                          : inc.severity === 'high' ? 'border-orange-500/25 bg-orange-500/5'
                          : 'border-amber-500/20 bg-amber-500/5'
                        )} data-testid={`incident-audit-${inc.id}`}>
                          <div className="flex items-center gap-2">
                            {statusIcon(inc.severity === 'critical' || inc.severity === 'high' ? 'fail' : 'warn')}
                            <span className="text-xs font-bold text-foreground">{inc.entityName ?? inc.entityId}</span>
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{inc.incidentType}</span>
                            <span className="ml-auto text-[9px] text-muted-foreground/60">
                              {new Date(inc.openedAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5 ml-5">{inc.title}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.incidents.recentlyClosed.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 font-semibold">
                      Recently Resolved (24h)
                    </p>
                    <div className="space-y-1">
                      {data.incidents.recentlyClosed.map((inc) => (
                        <div key={inc.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/15 bg-emerald-500/5">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                          <span className="text-[10px] text-foreground/80">{inc.entityName ?? inc.entityId}</span>
                          <span className="text-[9px] text-muted-foreground">{inc.incidentType}</span>
                          <span className="ml-auto text-[9px] text-muted-foreground/60">
                            {inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleTimeString() : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* ── 6. Cross-Engine Assertions ── */}
            <SectionCard title="Cross-Engine Assertions" icon={<GitBranch className="w-4 h-4" />} status={data.crossValidation.status}>
              <div className="space-y-2">
                <div className="flex gap-2 text-[10px] text-muted-foreground mb-1">
                  <span className="text-emerald-400 font-semibold">{data.crossValidation.passed} passed</span>
                  {data.crossValidation.warned > 0 && <span className="text-amber-400 font-semibold">{data.crossValidation.warned} warned</span>}
                  {data.crossValidation.failed > 0 && <span className="text-rose-400 font-semibold">{data.crossValidation.failed} failed</span>}
                  <span>· {data.crossValidation.assertions.length} assertions total</span>
                </div>
                <div className="space-y-1.5">
                  {data.crossValidation.assertions.map((a, i) => (
                    <div key={i} className={cn(
                      "flex items-start gap-2.5 px-3 py-2 rounded-lg border",
                      a.status === 'pass' ? 'border-emerald-500/15 bg-emerald-500/5'
                      : a.status === 'warn' ? 'border-amber-500/20 bg-amber-500/5'
                      : 'border-rose-500/25 bg-rose-500/5'
                    )} data-testid={`assertion-${i}`}>
                      <div className="flex-shrink-0 mt-0.5">{statusIcon(a.status)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-foreground/90">{a.assertion}</p>
                        <p className="text-[9px] text-muted-foreground font-mono mt-0.5">{a.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

          </div>
        )}

        {/* Footer note */}
        <p className="text-[10px] text-muted-foreground/50 text-center mt-6">
          All data sourced from live CDR cache and incident database · Auto-refreshes every 5 minutes · Admin and management access only
        </p>
      </div>
    </div>
  );
}
