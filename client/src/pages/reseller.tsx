import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Layers, Plus, Trash2, Edit2, CheckCircle2, XCircle, DollarSign,
  Users, TrendingUp, TrendingDown, Info, BarChart3, FileText,
  RefreshCw, ChevronDown, ChevronUp, Download, Phone, Clock,
  Percent, AlertTriangle, Building2, Mail, Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface Reseller {
  id: number;
  name: string;
  contactEmail: string | null;
  markupPercent: number;
  iCustomer: number | null;
  brandName: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
}

interface ResellerStats {
  totalCalls: number;
  answeredCalls: number;
  totalMins: number;
  cost: number;
  revenue: number;
  margin: number;
  marginPct: number;
  asr: number;
  acd: number;
  topDestinations: { dest: string; calls: number; mins: number; cost: number; revenue: number }[];
  dailySeries: { date: string; calls: number; answered: number; mins: number; cost: number; revenue: number }[];
  cdrSource: string;
  days: number;
}

interface StatementData {
  resellerName: string;
  brandName: string | null;
  contactEmail: string | null;
  month: string;
  markup: number;
  totalCalls: number;
  answeredCalls: number;
  totalMins: number;
  cost: number;
  revenue: number;
  margin: number;
  asr: number;
  lineItems: { prefix: string; calls: number; answered: number; mins: number; cost: number; revenue: number; margin: number }[];
  generatedAt: string;
}

const EMPTY_FORM = { name: '', contactEmail: '', markupPercent: 10, iCustomer: '', brandName: '', notes: '' };

const DAYS_OPTIONS = [
  { value: '7',  label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '90', label: 'Last 90 days' },
];

function fmt$(v: number) { return `$${v.toFixed(2)}`; }
function fmtMins(m: number) {
  if (m < 1) return `${Math.round(m * 60)}s`;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function MiniBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden">
      <div className={cn("h-full rounded-full", className ?? "bg-emerald-500")} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Stats card strip ──────────────────────────────────────────────────────────
function StatsStrip({ stats, markup }: { stats: ResellerStats; markup: number }) {
  const tiles = [
    { label: "Total calls",   value: stats.totalCalls.toLocaleString(),    icon: Phone,      color: "text-foreground" },
    { label: "Minutes",       value: fmtMins(stats.totalMins),             icon: Clock,      color: "text-blue-400" },
    { label: "ASR",           value: `${stats.asr.toFixed(1)}%`,           icon: TrendingUp, color: stats.asr >= 70 ? "text-emerald-400" : stats.asr >= 50 ? "text-amber-400" : "text-rose-400" },
    { label: "Revenue",       value: fmt$(stats.revenue),                  icon: DollarSign, color: "text-emerald-400" },
    { label: "Margin",        value: fmt$(stats.margin),                   icon: Percent,    color: stats.margin >= 0 ? "text-emerald-400" : "text-rose-400" },
    { label: "Markup",        value: `${markup}%`,                         icon: TrendingUp, color: "text-amber-400" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 py-3 px-4 bg-muted/5 border-t border-border/30">
      {tiles.map(t => (
        <div key={t.label} className="text-center space-y-0.5">
          <p className={cn("text-sm font-bold tabular-nums", t.color)}>{t.value}</p>
          <p className="text-[10px] text-muted-foreground">{t.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Mini sparkline (SVG) ──────────────────────────────────────────────────────
function Sparkline({ data, valueKey, color = "#34d399" }: { data: any[]; valueKey: string; color?: string }) {
  if (!data.length) return null;
  const vals = data.map(d => d[valueKey] as number);
  const max = Math.max(...vals, 1);
  const w = 120, h = 28;
  const pts = vals.map((v, i) => {
    const x = (i / Math.max(vals.length - 1, 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Top destinations table ────────────────────────────────────────────────────
function TopDestinations({ dests, markup }: { dests: ResellerStats['topDestinations']; markup: number }) {
  if (!dests.length) return (
    <div className="text-xs text-muted-foreground/60 py-4 text-center">No destination data in CDR cache for this reseller.</div>
  );
  const maxMins = Math.max(...dests.map(d => d.mins), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/30">
            {["Destination","Calls","Minutes","Cost","Revenue","Margin%"].map(h => (
              <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dests.map((d, i) => {
            const margin = d.revenue - d.cost;
            const marginPct = d.revenue > 0 ? (margin / d.revenue) * 100 : 0;
            return (
              <tr key={i} className="border-b border-border/20 hover:bg-muted/10">
                <td className="px-3 py-2 font-mono text-xs">{d.dest}</td>
                <td className="px-3 py-2">{d.calls.toLocaleString()}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span>{fmtMins(d.mins)}</span>
                    <MiniBar value={d.mins} max={maxMins} />
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{fmt$(d.cost)}</td>
                <td className="px-3 py-2 font-mono text-emerald-400">{fmt$(d.revenue)}</td>
                <td className="px-3 py-2 font-mono">
                  <span className={marginPct >= 0 ? "text-emerald-400" : "text-rose-400"}>{marginPct.toFixed(1)}%</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Statement modal ───────────────────────────────────────────────────────────
function StatementModal({ reseller, onClose }: { reseller: Reseller; onClose: () => void }) {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const { data: stmt, isLoading } = useQuery<StatementData>({
    queryKey: ['/api/resellers', reseller.id, 'statement', month],
    queryFn: () => fetch(`/api/resellers/${reseller.id}/statement?month=${month}`).then(r => r.json()),
    staleTime: 60_000,
  });

  function downloadCsv() {
    if (!stmt) return;
    const rows = [
      ['Destination Prefix', 'Calls', 'Answered', 'Minutes', 'Cost (USD)', 'Revenue (USD)', 'Margin (USD)'],
      ...stmt.lineItems.map(l => [l.prefix, l.calls, l.answered, l.mins.toFixed(4), l.cost.toFixed(6), l.revenue.toFixed(6), l.margin.toFixed(6)]),
      [],
      ['TOTAL', stmt.totalCalls, stmt.answeredCalls, stmt.totalMins.toFixed(4), stmt.cost.toFixed(6), stmt.revenue.toFixed(6), stmt.margin.toFixed(6)],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${reseller.name.replace(/\s+/g, '_')}_${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-amber-400" />
            Statement — {reseller.brandName || reseller.name}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 pb-2">
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40 text-sm" />
          {stmt && (
            <Button size="sm" variant="outline" onClick={downloadCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading statement…
          </div>
        ) : stmt ? (
          <div className="space-y-4">
            {/* Invoice header */}
            <div className="bg-muted/10 border border-border/40 rounded-xl p-4 grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <p className="font-bold text-base">{stmt.brandName || stmt.resellerName}</p>
                {stmt.contactEmail && <p className="text-muted-foreground text-xs">{stmt.contactEmail}</p>}
                <p className="text-muted-foreground text-xs">Period: <strong className="text-foreground">{stmt.month}</strong></p>
              </div>
              <div className="text-right space-y-1">
                <p className="text-xs text-muted-foreground">Generated</p>
                <p className="text-xs">{new Date(stmt.generatedAt).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Markup applied: <strong className="text-amber-400">{stmt.markup}%</strong></p>
              </div>
            </div>

            {/* Summary KPIs */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Total Calls",  value: stmt.totalCalls.toLocaleString(),     sub: `${stmt.asr.toFixed(1)}% ASR`, color: "text-foreground" },
                { label: "Minutes",      value: fmtMins(stmt.totalMins),              sub: `${stmt.answeredCalls.toLocaleString()} answered`, color: "text-blue-400" },
                { label: "Revenue",      value: fmt$(stmt.revenue),                   sub: `Cost: ${fmt$(stmt.cost)}`, color: "text-emerald-400" },
                { label: "Margin",       value: fmt$(stmt.margin),                    sub: stmt.revenue > 0 ? `${((stmt.margin / stmt.revenue) * 100).toFixed(1)}% margin` : '—', color: stmt.margin >= 0 ? "text-emerald-400" : "text-rose-400" },
              ].map(k => (
                <div key={k.label} className="bg-card border border-border rounded-xl p-3 text-center">
                  <p className={cn("text-lg font-bold", k.color)}>{k.value}</p>
                  <p className="text-[10px] text-muted-foreground">{k.label}</p>
                  <p className="text-[10px] text-muted-foreground/60">{k.sub}</p>
                </div>
              ))}
            </div>

            {/* Line items */}
            {stmt.lineItems.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No CDR records found for {stmt.month}
                {!reseller.iCustomer && <span> — link this reseller to a Sippy Customer ID to pull usage data</span>}
              </div>
            ) : (
              <div className="overflow-x-auto border border-border/30 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-muted/10 border-b border-border/30">
                    <tr>
                      {["Dest. Prefix","Calls","Answered","Minutes","Cost","Revenue","Margin"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stmt.lineItems.map((l, i) => (
                      <tr key={i} className="border-b border-border/20 hover:bg-muted/10">
                        <td className="px-3 py-2 font-mono">{l.prefix}…</td>
                        <td className="px-3 py-2">{l.calls.toLocaleString()}</td>
                        <td className="px-3 py-2 text-muted-foreground">{l.answered.toLocaleString()}</td>
                        <td className="px-3 py-2">{fmtMins(l.mins)}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{fmt$(l.cost)}</td>
                        <td className="px-3 py-2 font-mono text-emerald-400">{fmt$(l.revenue)}</td>
                        <td className="px-3 py-2 font-mono">
                          <span className={l.margin >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmt$(l.margin)}</span>
                        </td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr className="border-t-2 border-border bg-muted/10 font-bold">
                      <td className="px-3 py-2">TOTAL</td>
                      <td className="px-3 py-2">{stmt.totalCalls.toLocaleString()}</td>
                      <td className="px-3 py-2">{stmt.answeredCalls.toLocaleString()}</td>
                      <td className="px-3 py-2">{fmtMins(stmt.totalMins)}</td>
                      <td className="px-3 py-2 font-mono">{fmt$(stmt.cost)}</td>
                      <td className="px-3 py-2 font-mono text-emerald-400">{fmt$(stmt.revenue)}</td>
                      <td className="px-3 py-2 font-mono">
                        <span className={stmt.margin >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmt$(stmt.margin)}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reseller row / expanded card ──────────────────────────────────────────────
function ResellerCard({
  reseller, onEdit, onToggle, onDelete, onStatement,
}: {
  reseller: Reseller;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onStatement: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState('30');

  const { data: stats, isLoading: statsLoading, refetch } = useQuery<ResellerStats>({
    queryKey: ['/api/resellers', reseller.id, 'stats', days],
    queryFn: () => fetch(`/api/resellers/${reseller.id}/stats?days=${days}`).then(r => r.json()),
    enabled: expanded,
    staleTime: 120_000,
  });

  return (
    <div className={cn(
      "border border-border/50 rounded-xl overflow-hidden bg-card transition-opacity",
      !reseller.active && "opacity-60",
    )} data-testid={`card-reseller-${reseller.id}`}>
      {/* Header row */}
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            <span className="font-semibold text-sm" data-testid={`text-reseller-name-${reseller.id}`}>{reseller.name}</span>
            {reseller.brandName && (
              <Badge variant="outline" className="text-[10px]">{reseller.brandName}</Badge>
            )}
            <span className={cn(
              "text-[10px] font-semibold",
              reseller.active ? "text-emerald-400" : "text-muted-foreground/50"
            )}>
              {reseller.active ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0 text-xs text-muted-foreground">
            {reseller.contactEmail && (
              <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{reseller.contactEmail}</span>
            )}
            {reseller.iCustomer && (
              <span className="flex items-center gap-1"><Hash className="h-3 w-3" />Sippy #{reseller.iCustomer}</span>
            )}
            {!reseller.iCustomer && (
              <span className="flex items-center gap-1 text-amber-400/70"><AlertTriangle className="h-3 w-3" />No Sippy customer linked</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-base font-bold text-amber-400">+{reseller.markupPercent}%</p>
            <p className="text-[10px] text-muted-foreground">markup</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onStatement}
              title="Monthly statement"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
              data-testid={`button-statement-${reseller.id}`}
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              data-testid={`button-edit-reseller-${reseller.id}`}
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onToggle}
              title={reseller.active ? "Deactivate" : "Activate"}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {reseller.active ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              data-testid={`button-delete-reseller-${reseller.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setExpanded(v => !v)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              data-testid={`button-expand-reseller-${reseller.id}`}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-border/30">
          {/* Stats header */}
          <div className="flex items-center justify-between px-4 py-2 bg-muted/5 border-b border-border/20">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-xs font-semibold">Usage & Revenue</span>
            </div>
            <div className="flex items-center gap-2">
              <Select value={days} onValueChange={v => { setDays(v); }}>
                <SelectTrigger className="h-7 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <button
                onClick={() => refetch()}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                title="Refresh"
              >
                <RefreshCw className={cn("h-3 w-3", statsLoading && "animate-spin")} />
              </button>
            </div>
          </div>

          {statsLoading ? (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-xs">
              <RefreshCw className="h-3.5 w-3.5 animate-spin mr-2" /> Loading usage data…
            </div>
          ) : !reseller.iCustomer ? (
            <div className="px-4 py-6 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold text-amber-300">Sippy Customer ID not linked</p>
                <p className="mt-0.5">Edit this reseller and set the <strong>Sippy Customer ID</strong> to automatically pull CDR usage and compute revenue, margin, and destination reports.</p>
              </div>
            </div>
          ) : stats ? (
            <>
              <StatsStrip stats={stats} markup={reseller.markupPercent} />

              {/* Trend sparkline + top dests */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border/30">
                {/* Sparkline */}
                <div className="px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Revenue trend</p>
                  {stats.dailySeries.length > 1 ? (
                    <div className="flex items-end gap-1 h-10">
                      {stats.dailySeries.map((d, i) => {
                        const maxRev = Math.max(...stats.dailySeries.map(x => x.revenue), 0.001);
                        const pct = (d.revenue / maxRev) * 100;
                        return (
                          <div key={i} className="flex-1 bg-emerald-500/20 rounded-sm relative group" style={{ height: `${Math.max(4, pct)}%` }}>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 bg-card border border-border rounded px-1.5 py-0.5 text-[9px] whitespace-nowrap">
                              {d.date}: {fmt$(d.revenue)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/50">Not enough data for trend</p>
                  )}
                  <div className="flex justify-between text-[10px] text-muted-foreground/50">
                    <span>{stats.dailySeries[0]?.date ?? ''}</span>
                    <span>{stats.dailySeries[stats.dailySeries.length - 1]?.date ?? ''}</span>
                  </div>
                </div>

                {/* Top destinations */}
                <div className="px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Top destinations</p>
                  <TopDestinations dests={stats.topDestinations.slice(0, 5)} markup={reseller.markupPercent} />
                </div>
              </div>

              {stats.cdrSource === 'no_customer_linked' && (
                <div className="px-4 py-2 text-xs text-amber-400/70 border-t border-border/20 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" /> CDR data unavailable — link a Sippy Customer ID to see live usage.
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Create/Edit dialog ────────────────────────────────────────────────────────
function ResellerDialog({ editing, onClose }: { editing: Reseller | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(editing
    ? { name: editing.name, contactEmail: editing.contactEmail ?? '', markupPercent: editing.markupPercent, iCustomer: editing.iCustomer ? String(editing.iCustomer) : '', brandName: editing.brandName ?? '', notes: editing.notes ?? '' }
    : { ...EMPTY_FORM }
  );

  const mutation = useMutation({
    mutationFn: (body: typeof form) => {
      const payload = { ...body, iCustomer: body.iCustomer ? Number(body.iCustomer) : null };
      return editing
        ? apiRequest('PATCH', `/api/resellers/${editing.id}`, payload)
        : apiRequest('POST', '/api/resellers', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/resellers'] });
      toast({ title: editing ? "Reseller updated" : "Reseller created", description: form.name });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const set = (k: keyof typeof form) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit: ${editing.name}` : "New Reseller"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Company Name *</label>
              <Input value={form.name} onChange={set('name')} data-testid="input-reseller-name" placeholder="Operator Ltd." />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Brand / White-Label</label>
              <Input value={form.brandName} onChange={set('brandName')} placeholder="optional" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Contact Email</label>
            <Input type="email" value={form.contactEmail} onChange={set('contactEmail')} placeholder="billing@operator.com" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Markup (%)</label>
              <Input
                type="number" min={0} max={500} step={0.5}
                value={form.markupPercent}
                onChange={e => setForm(f => ({ ...f, markupPercent: Number(e.target.value) }))}
                data-testid="input-markup"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Sippy Customer ID</label>
              <Input
                type="number"
                value={form.iCustomer}
                onChange={set('iCustomer')}
                placeholder="e.g. 42"
                data-testid="input-icustomer"
              />
            </div>
          </div>
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-200/80">
            Setting the <strong>Sippy Customer ID</strong> links CDR usage data — enabling automatic revenue, margin, and statement generation.
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Notes</label>
            <Textarea value={form.notes} onChange={set('notes')} className="min-h-[72px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={!form.name || mutation.isPending}
            data-testid="button-save-reseller"
          >
            {mutation.isPending && <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />}
            {editing ? "Save Changes" : "Create Reseller"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ResellerPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Reseller | null>(null);
  const [statementTarget, setStatementTarget] = useState<Reseller | null>(null);

  const { data: resellers = [], isLoading } = useQuery<Reseller[]>({
    queryKey: ['/api/resellers'],
    staleTime: 30000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => apiRequest('PATCH', `/api/resellers/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/resellers'] }),
    onError: (e: any) => toast({ title: "Toggle failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/resellers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/resellers'] }); toast({ title: "Reseller deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const activeCount    = resellers.filter(r => r.active).length;
  const linkedCount    = resellers.filter(r => r.iCustomer).length;
  const avgMarkup      = resellers.length ? resellers.reduce((s, r) => s + r.markupPercent, 0) / resellers.length : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Layers className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Reseller Management</h1>
              <p className="text-sm text-muted-foreground">
                Wholesale operators — markup rules, CDR-based revenue tracking, and monthly statements
              </p>
            </div>
          </div>
          <Button onClick={() => { setEditing(null); setShowDialog(true); }} data-testid="button-new-reseller">
            <Plus className="h-4 w-4 mr-2" /> New Reseller
          </Button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Resellers", value: resellers.length, icon: Users,      color: "text-foreground" },
            { label: "Active",          value: activeCount,       icon: CheckCircle2, color: "text-emerald-400" },
            { label: "Sippy Linked",    value: linkedCount,       icon: Hash,       color: "text-blue-400" },
            { label: "Avg Markup",      value: `${avgMarkup.toFixed(1)}%`, icon: TrendingUp, color: "text-amber-400" },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
              <s.icon className={cn("h-5 w-5 shrink-0", s.color)} />
              <div>
                <p className={cn("text-xl font-bold", s.color)}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Info banner */}
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              Link each reseller to their <strong className="text-foreground/80">Sippy Customer ID</strong> to automatically pull CDR-based usage,
              compute wholesale revenue at your markup rate, calculate margin per destination, and generate monthly statements for invoicing.
              Without a customer link, only profile data is stored.
            </p>
          </div>
        </div>

        {/* Reseller list */}
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />Loading…
          </div>
        ) : resellers.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Layers className="h-6 w-6 text-amber-400/50" />
            </div>
            <p className="text-sm text-muted-foreground">No resellers yet.</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto">
              Add your wholesale partners — link them to Sippy customer IDs to get automatic revenue tracking, margin reports, and monthly statements.
            </p>
            <Button size="sm" variant="outline" onClick={() => { setEditing(null); setShowDialog(true); }}>
              Add First Reseller
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {resellers.map(r => (
              <ResellerCard
                key={r.id}
                reseller={r}
                onEdit={() => { setEditing(r); setShowDialog(true); }}
                onToggle={() => toggleMutation.mutate({ id: r.id, active: !r.active })}
                onDelete={() => { if (confirm(`Delete "${r.name}" and all data?`)) deleteMutation.mutate(r.id); }}
                onStatement={() => setStatementTarget(r)}
              />
            ))}
          </div>
        )}
      </div>

      {showDialog && (
        <ResellerDialog
          editing={editing}
          onClose={() => { setShowDialog(false); setEditing(null); }}
        />
      )}

      {statementTarget && (
        <StatementModal
          reseller={statementTarget}
          onClose={() => setStatementTarget(null)}
        />
      )}
    </div>
  );
}
