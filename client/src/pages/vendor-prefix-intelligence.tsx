import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  Globe, RefreshCw, BarChart2, Table2, AlertTriangle,
  CheckCircle2, XCircle, TrendingDown, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────────────────────
interface QComponents { asr: number; ner: number; fas: number; pdd: number; }

interface PrefixBucket {
  label: string;
  country: string;
  iso2: string;
  flag: string;
  type: string;
  calls: number;
  answered: number;
  asr: number;
  ner: number;
  avgPdd: number;
  fasEvents: number;
  fasRate: number;
  q: number;
  components: QComponents;
  status: 'pass' | 'warn' | 'fail';
  insufficient: boolean;
}

interface VendorRow {
  vendor: string;
  totalCalls: number;
  overallQ: number;
  prefixes: PrefixBucket[];
}

interface PrefixResponse {
  generatedAt: string;
  windowHours: number;
  cdrCount: number;
  vendors: VendorRow[];
  heatmap: {
    countries: string[];
    countryFlags: Record<string, string>;
    rows: Array<{ vendor: string; scores: Record<string, number | null> }>;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const qColor = (q: number | null, insufficient = false) => {
  if (q === null || insufficient) return 'text-muted-foreground/40';
  if (q >= 75) return 'text-emerald-400';
  if (q >= 55) return 'text-sky-400';
  if (q >= 35) return 'text-amber-400';
  return 'text-rose-400';
};

const qBg = (q: number | null) => {
  if (q === null) return 'bg-muted/10';
  if (q >= 75) return 'bg-emerald-500/15 border-emerald-500/30';
  if (q >= 55) return 'bg-sky-500/10 border-sky-500/20';
  if (q >= 35) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-rose-500/10 border-rose-500/25';
};

const heatColor = (q: number | null) => {
  if (q === null) return 'bg-muted/10 text-muted-foreground/30';
  if (q >= 75) return 'bg-emerald-500/25 text-emerald-300 font-bold';
  if (q >= 55) return 'bg-sky-500/20 text-sky-300 font-bold';
  if (q >= 35) return 'bg-amber-500/20 text-amber-300 font-bold';
  return 'bg-rose-500/20 text-rose-300 font-bold';
};

const statusIcon = (s: 'pass' | 'warn' | 'fail') =>
  s === 'pass' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
  : s === 'warn' ? <AlertTriangle className="w-3 h-3 text-amber-400" />
  : <XCircle className="w-3 h-3 text-rose-400" />;

const typeTag = (type: string) => (
  <span className={cn(
    "text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border",
    type === 'mobile'  ? 'bg-violet-500/15 border-violet-500/30 text-violet-300' :
    type === 'fixed'   ? 'bg-slate-500/15 border-slate-500/30 text-slate-300' :
                         'bg-amber-500/10 border-amber-500/25 text-amber-300'
  )}>
    {type}
  </span>
);

// ── Bar component ─────────────────────────────────────────────────────────────
function QBar({ label, pts, maxPts, color }: { label: string; pts: number; maxPts: number; color: string }) {
  const pct = maxPts > 0 ? (pts / maxPts) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-muted-foreground/70 w-7 text-right">{label}</span>
      <div className="flex-1 h-1.5 bg-muted/20 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] font-mono text-muted-foreground w-5 text-right">{pts}</span>
    </div>
  );
}

// ── Prefix row ────────────────────────────────────────────────────────────────
function PrefixRow({ p, expanded, onToggle }: { p: PrefixBucket; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/5 transition-colors"
        onClick={onToggle}
        data-testid={`prefix-row-${p.label}`}
      >
        <span className="text-sm">{p.flag}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-foreground">{p.country}</span>
            {typeTag(p.type)}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground ml-auto">
          <span>{p.calls.toLocaleString()} calls</span>
          {p.fasEvents > 0 && (
            <span className="text-rose-400 font-semibold">{p.fasEvents} FAS</span>
          )}
        </div>
        {p.insufficient ? (
          <span className="text-[9px] text-muted-foreground/50 italic ml-1">low data</span>
        ) : (
          <span className={cn("font-mono font-bold text-sm ml-1 w-10 text-right", qColor(p.q))}>
            Q{p.q}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-border/30 bg-muted/5 px-3 py-2.5 space-y-2.5">
          {p.insufficient ? (
            <p className="text-[10px] text-muted-foreground italic">
              Fewer than 5 calls — Q-score withheld (insufficient sample)
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 text-[10px]">
                <div>
                  <span className="text-muted-foreground/60">ASR</span>
                  <span className={cn("ml-1.5 font-mono font-bold",
                    p.asr >= 60 ? 'text-emerald-400' : p.asr >= 40 ? 'text-amber-400' : 'text-rose-400')}>
                    {p.asr}%
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground/60">NER</span>
                  <span className={cn("ml-1.5 font-mono font-bold",
                    p.ner >= 55 ? 'text-emerald-400' : p.ner >= 35 ? 'text-amber-400' : 'text-rose-400')}>
                    {p.ner}%
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground/60">Avg PDD</span>
                  <span className={cn("ml-1.5 font-mono font-bold",
                    p.avgPdd < 3 ? 'text-emerald-400' : p.avgPdd < 8 ? 'text-amber-400' : 'text-rose-400')}>
                    {p.avgPdd}s
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground/60">Answered</span>
                  <span className="ml-1.5 font-mono text-foreground/70">{p.answered}</span>
                </div>
                <div>
                  <span className="text-muted-foreground/60">FAS rate</span>
                  <span className={cn("ml-1.5 font-mono font-bold",
                    p.fasRate === 0 ? 'text-emerald-400' : p.fasRate < 5 ? 'text-amber-400' : 'text-rose-400')}>
                    {p.fasRate}%
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground/60">Status</span>
                  <span className="ml-1.5 inline-flex items-center gap-1">{statusIcon(p.status)}</span>
                </div>
              </div>
              <div className="space-y-1 pt-1 border-t border-border/20">
                <p className="text-[8px] uppercase tracking-widest text-muted-foreground/50 mb-1.5 font-semibold">Q-Score breakdown</p>
                <QBar label="ASR" pts={p.components.asr} maxPts={40} color="bg-emerald-500" />
                <QBar label="NER" pts={p.components.ner} maxPts={30} color="bg-sky-500" />
                <QBar label="FAS" pts={p.components.fas} maxPts={20} color="bg-violet-500" />
                <QBar label="PDD" pts={p.components.pdd} maxPts={10} color="bg-amber-500" />
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-border/20">
                  <span className="text-[9px] text-muted-foreground/60 font-semibold">Composite Q</span>
                  <span className={cn("font-mono font-bold text-sm", qColor(p.q))}>Q{p.q}/100</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VendorPrefixIntelligencePage() {
  const qc = useQueryClient();
  const [view, setView]             = useState<'table' | 'heatmap'>('table');
  const [activeVendor, setActiveVendor] = useState<string | null>(null);
  const [expandedPrefix, setExpandedPrefix] = useState<string | null>(null);

  const { data, isLoading, dataUpdatedAt } = useQuery<PrefixResponse>({
    queryKey: ['/api/vendor-prefix-intelligence'],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });

  const vendor = data?.vendors.find(v => v.vendor === activeVendor) ?? data?.vendors[0];

  const allVendors = data?.vendors ?? [];

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <div className="border-b border-border/40 bg-card/30">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                <Globe className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">Destination Prefix Intelligence</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Q-scores per vendor × destination · Last 24h · {data?.cdrCount.toLocaleString() ?? '—'} CDRs
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {data && (
                <span className="text-[10px] text-muted-foreground">
                  updated {new Date(data.generatedAt).toLocaleTimeString()}
                </span>
              )}
              {/* View toggle */}
              <div className="flex items-center rounded-lg border border-border/40 bg-muted/10 p-0.5 gap-0.5">
                <button
                  className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    view === 'table' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
                  onClick={() => setView('table')}
                  data-testid="view-table"
                >
                  <Table2 className="w-3.5 h-3.5" /> Table
                </button>
                <button
                  className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    view === 'heatmap' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
                  onClick={() => setView('heatmap')}
                  data-testid="view-heatmap"
                >
                  <Layers className="w-3.5 h-3.5" /> Heatmap
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => qc.invalidateQueries({ queryKey: ['/api/vendor-prefix-intelligence'] })}
                data-testid="btn-refresh"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>

          {/* ── Vendor summary pills ── */}
          {data && data.vendors.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {data.vendors.map(v => (
                <button
                  key={v.vendor}
                  onClick={() => { setActiveVendor(v.vendor); setView('table'); setExpandedPrefix(null); }}
                  data-testid={`vendor-tab-${v.vendor}`}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all",
                    (vendor?.vendor === v.vendor && view === 'table')
                      ? "border-violet-500/50 bg-violet-500/10 text-foreground"
                      : "border-border/30 bg-card/30 text-muted-foreground hover:text-foreground hover:border-border/60"
                  )}
                >
                  <BarChart2 className="w-3 h-3" />
                  {v.vendor}
                  <span className={cn("font-mono text-xs", qColor(v.overallQ))}>
                    {v.overallQ > 0 ? `Q${v.overallQ}` : '—'}
                  </span>
                  <span className="text-[9px] text-muted-foreground/60">{v.totalCalls.toLocaleString()} calls</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" /> Computing destination prefix intelligence…
          </div>
        ) : !data || data.vendors.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Globe className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No CDR data with vendor + destination information in the last 24 hours.</p>
            <p className="text-xs text-muted-foreground/60">CDR cache currently holds {data?.cdrCount ?? 0} records. Vendor enrichment may be pending.</p>
          </div>
        ) : view === 'heatmap' ? (
          // ── Heatmap view ───────────────────────────────────────────────────
          <div>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground">Vendor × Destination Heatmap</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Q-score per vendor per country · colour: <span className="text-emerald-400">Q≥75 excellent</span> ·
                <span className="text-sky-400 ml-1">Q≥55 good</span> ·
                <span className="text-amber-400 ml-1">Q≥35 warn</span> ·
                <span className="text-rose-400 ml-1">Q&lt;35 critical</span>
              </p>
            </div>
            <div className="rounded-xl border border-border/40 overflow-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-muted/20 border-b border-border/30">
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-semibold min-w-[140px] sticky left-0 bg-muted/20 z-10">
                      Vendor
                    </th>
                    {data.heatmap.countries.map(c => (
                      <th key={c} className="text-center px-3 py-2.5 text-muted-foreground font-medium whitespace-nowrap min-w-[90px]">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-base">{data.heatmap.countryFlags[c] ?? '🌐'}</span>
                          <span className="text-[9px] leading-tight">{c.length > 12 ? c.slice(0, 11) + '…' : c}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.heatmap.rows.map((row) => (
                    <tr key={row.vendor} className="border-b border-border/20 hover:bg-muted/5 transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-foreground sticky left-0 bg-background z-10 border-r border-border/20">
                        <div className="flex items-center gap-2">
                          <span>{row.vendor}</span>
                          {allVendors.find(v => v.vendor === row.vendor)?.overallQ != null && (
                            <span className={cn("text-[10px] font-mono", qColor(allVendors.find(v => v.vendor === row.vendor)?.overallQ ?? null))}>
                              Q{allVendors.find(v => v.vendor === row.vendor)?.overallQ}
                            </span>
                          )}
                        </div>
                      </td>
                      {data.heatmap.countries.map(c => {
                        const q = row.scores[c] ?? null;
                        return (
                          <td key={c} className="px-2 py-2" data-testid={`heatmap-${row.vendor}-${c}`}>
                            <div className={cn("rounded text-center py-1.5 px-1 text-xs", heatColor(q))}>
                              {q !== null ? `Q${q}` : '—'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[9px] text-muted-foreground/40 mt-2 text-center">
              — = no calls in this window or insufficient sample (&lt;5 calls). Scores weighted by call volume.
            </p>
          </div>
        ) : (
          // ── Table view — single vendor ────────────────────────────────────
          vendor && (
            <div className="space-y-4">
              {/* Vendor summary card */}
              <div className={cn(
                "rounded-xl border p-4 flex items-center gap-4",
                qBg(vendor.overallQ)
              )}>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Vendor</p>
                  <p className="text-sm font-bold text-foreground">{vendor.vendor}</p>
                </div>
                <div className="border-l border-border/40 pl-4">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Overall Q</p>
                  <p className={cn("text-2xl font-bold font-mono", qColor(vendor.overallQ))}>
                    {vendor.overallQ > 0 ? `Q${vendor.overallQ}` : '—'}
                  </p>
                </div>
                <div className="border-l border-border/40 pl-4">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Calls (24h)</p>
                  <p className="text-lg font-bold text-foreground">{vendor.totalCalls.toLocaleString()}</p>
                </div>
                <div className="border-l border-border/40 pl-4">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Destinations</p>
                  <p className="text-lg font-bold text-foreground">{vendor.prefixes.length}</p>
                </div>
                {vendor.prefixes.filter(p => p.status === 'fail' && !p.insufficient).length > 0 && (
                  <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25">
                    <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                    <span className="text-xs text-rose-300 font-semibold">
                      {vendor.prefixes.filter(p => p.status === 'fail' && !p.insufficient).length} critical destination{vendor.prefixes.filter(p => p.status === 'fail' && !p.insufficient).length !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>

              {/* Prefix list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
                    Destination Breakdown · {vendor.prefixes.length} prefix group{vendor.prefixes.length !== 1 ? 's' : ''}
                  </p>
                  <p className="text-[9px] text-muted-foreground/50">Click a row to see Q-score breakdown</p>
                </div>
                <div className="space-y-1.5">
                  {vendor.prefixes.map((p) => {
                    const key = `${vendor.vendor}||${p.label}`;
                    return (
                      <PrefixRow
                        key={key}
                        p={p}
                        expanded={expandedPrefix === key}
                        onToggle={() => setExpandedPrefix(expandedPrefix === key ? null : key)}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 pt-2 text-[10px] text-muted-foreground/60">
                <span><span className="font-semibold text-emerald-400">Q≥75</span> excellent</span>
                <span><span className="font-semibold text-sky-400">Q55–74</span> good</span>
                <span><span className="font-semibold text-amber-400">Q35–54</span> watch</span>
                <span><span className="font-semibold text-rose-400">Q&lt;35</span> critical</span>
                <span className="ml-auto">ASR 40% · NER 30% · FAS 20% · PDD 10%</span>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
