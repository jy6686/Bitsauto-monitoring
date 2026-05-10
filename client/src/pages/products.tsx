import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { lookupCLD } from "@/lib/country-lookup";
import {
  subHoursUTC, subDaysUTC, startOfDayUTC, endOfDayUTC,
  startOfWeekUTC, subWeeksUTC, endOfWeekUTC,
  startOfMonthUTC, subMonthsUTC, endOfMonthUTC,
  formatUTC,
} from "@/lib/date-utils";
import { useTimezone } from "@/context/timezone-context";
import {
  Package, Phone, Clock, DollarSign, Activity, BarChart3,
  TrendingUp, RefreshCw, ChevronDown, ChevronUp, Users,
  Globe, Network, Layers, Timer, X, Check,
  FileText, Plus, Pencil, Trash2, Save, BookOpen, ChevronRight, Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Product class definitions ─────────────────────────────────────────────────
const PRODUCT_CLASSES = [
  { prefix: '1', label: 'First Class Wholesale',   short: 'First',    color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20',      dot: 'bg-blue-400',    ring: 'ring-blue-500/30'    },
  { prefix: '2', label: 'Business Class Wholesale', short: 'Business', color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20',  dot: 'bg-violet-400',  ring: 'ring-violet-500/30'  },
  { prefix: '6', label: 'Special Bravo',            short: 'Bravo',    color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20',    dot: 'bg-amber-400',   ring: 'ring-amber-500/30'   },
  { prefix: '7', label: 'Special Charlie',          short: 'Charlie',  color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20',  dot: 'bg-orange-400',  ring: 'ring-orange-500/30'  },
  { prefix: 'other', label: 'Unclassified',         short: 'Other',    color: 'text-muted-foreground', bg: 'bg-muted/30 border-border',        dot: 'bg-muted-foreground', ring: 'ring-border' },
] as const;

type ProductPrefix = '1' | '2' | '6' | '7' | 'other';
type IntelTab = 'clients' | 'destinations' | 'breakout' | 'rates' | 'minutes';

interface ProductStats {
  calls: number;
  answered: number;
  totalDuration: number;
  billedDuration: number;
  cost: number;
  topCountries: Record<string, number>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function emptyStats(): ProductStats {
  return { calls: 0, answered: 0, totalDuration: 0, billedDuration: 0, cost: 0, topCountries: {} };
}

function fmtDurSec(seconds: number): string {
  const s = Math.round(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function fmtMin(seconds: number): string {
  return (seconds / 60).toFixed(1) + ' min';
}

function classifyNetwork(cld: string): 'Mobile' | 'Landline' | 'Premium' | 'Satellite' {
  if (!cld) return 'Landline';
  let n = cld.replace(/\D/g, '');
  // Strip Sippy routing-class prefix (1/2/6/7) before network detection.
  // e.g. "1923400593877" → strip "1" (First Class) → "923400593877" = Pakistan Mobile
  if (n.length >= 11 && ['1','2','6','7'].includes(n[0])) n = n.slice(1);
  // Premium / special
  if (/^(0900|1900|0800|0808|0845|0870|1800|1888|1877|1866|1855|1844|1833|1822)/.test(n)) return 'Premium';
  if (/^8810|^8811|^8812|^8813/.test(n)) return 'Satellite'; // Inmarsat
  // Pakistan mobile: 923xx
  if (/^923[0-9]/.test(n)) return 'Mobile';
  if (/^92[2-9][0-9]{1,2}/.test(n)) return 'Landline';
  // India mobile: 91[6-9]
  if (/^91[6-9]/.test(n)) return 'Mobile';
  if (/^91[0-5]/.test(n)) return 'Landline';
  // Bangladesh mobile: 88013-18
  if (/^8801[3-9]/.test(n)) return 'Mobile';
  if (/^8802/.test(n)) return 'Landline';
  // Nepal mobile: 9779[8-9]
  if (/^9779[6-9]/.test(n)) return 'Mobile';
  if (/^9771/.test(n)) return 'Landline';
  // Sri Lanka mobile: 9477
  if (/^9477/.test(n)) return 'Mobile';
  if (/^9411/.test(n)) return 'Landline';
  // UK mobile: 447
  if (/^447[1-9]/.test(n)) return 'Mobile';
  if (/^441/.test(n)) return 'Landline';
  // USA mobile vs landline is hard to distinguish; treat as Landline unless area code known
  if (/^1[2-9]\d{2}[2-9]/.test(n)) return 'Landline';
  return 'Landline';
}

const NETWORK_META: Record<string, { icon: string; color: string; bg: string }> = {
  Mobile:    { icon: '📱', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  Landline:  { icon: '📞', color: 'text-blue-400',    bg: 'bg-blue-500/10'    },
  Premium:   { icon: '⭐', color: 'text-amber-400',   bg: 'bg-amber-500/10'   },
  Satellite: { icon: '🛰', color: 'text-violet-400',  bg: 'bg-violet-500/10'  },
};

// ── Multi-select dropdown ─────────────────────────────────────────────────────
function MultiSelect({
  options, selected, onChange, placeholder, testId,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]);
  };

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium",
          "bg-background hover:bg-muted/50 border-border transition-colors",
          "text-left min-w-[140px] max-w-[220px]",
          open && "ring-1 ring-primary/40"
        )}
      >
        <span className="flex-1 truncate text-foreground/80">{label}</span>
        {selected.length > 0 && (
          <span
            className="h-4 w-4 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-bold flex-shrink-0"
            onClick={e => { e.stopPropagation(); onChange([]); }}
          >
            {selected.length}
          </span>
        )}
        <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[200px] max-w-[280px] max-h-56 overflow-y-auto rounded-lg border border-border bg-popover shadow-xl">
          {selected.length > 0 && (
            <div className="px-2 pt-2 pb-1 border-b border-border/50">
              <button
                onClick={() => onChange([])}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-2.5 w-2.5" /> Clear all
              </button>
            </div>
          )}
          {options.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground italic">No options</div>
          )}
          {options.map(opt => (
            <div
              key={opt}
              onClick={() => toggle(opt)}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 cursor-pointer transition-colors"
            >
              <div className={cn(
                "h-3.5 w-3.5 rounded border flex items-center justify-center flex-shrink-0",
                selected.includes(opt) ? "bg-primary border-primary" : "border-border"
              )}>
                {selected.includes(opt) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </div>
              <span className="truncate text-foreground/80">{opt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Intelligence Panel ────────────────────────────────────────────────────────
function IntelPanel({
  cls, cdrs,
}: {
  cls: typeof PRODUCT_CLASSES[number];
  cdrs: any[];
}) {
  const [tab, setTab] = useState<IntelTab>('clients');
  const [selClients, setSelClients] = useState<string[]>([]);
  const [selDests, setSelDests] = useState<string[]>([]);
  const [selBreakouts, setSelBreakouts] = useState<string[]>([]);

  // Filter CDRs to this product
  const productCdrs = useMemo(() =>
    cdrs.filter(c => {
      const info = c.callee ? lookupCLD(c.callee) : null;
      const p = info?.trunkPrefix ?? 'other';
      return p === cls.prefix;
    }), [cdrs, cls.prefix]);

  // Derive unique options
  const allClients = useMemo(() => {
    const s = new Set<string>();
    for (const c of productCdrs) {
      const name = c.clientName || (c.iAccount ? `Acct.${c.iAccount}` : 'Unknown');
      s.add(name);
    }
    return Array.from(s).sort();
  }, [productCdrs]);

  const allDests = useMemo(() => {
    const s = new Set<string>();
    for (const c of productCdrs) {
      const info = c.callee ? lookupCLD(c.callee) : null;
      const name = info?.country ? `${info.country.flag} ${info.country.name}` : (c.country || 'Unknown');
      s.add(name);
    }
    return Array.from(s).sort();
  }, [productCdrs]);

  const allBreakouts = useMemo(() => {
    const s = new Set<string>();
    for (const c of productCdrs) s.add(classifyNetwork(c.callee || ''));
    return Array.from(s).sort();
  }, [productCdrs]);

  // Apply combined filters
  const filteredCdrs = useMemo(() => {
    return productCdrs.filter(c => {
      const clientName = c.clientName || (c.iAccount ? `Acct.${c.iAccount}` : 'Unknown');
      const info = c.callee ? lookupCLD(c.callee) : null;
      const dest = info?.country ? `${info.country.flag} ${info.country.name}` : (c.country || 'Unknown');
      const breakout = classifyNetwork(c.callee || '');
      if (selClients.length > 0 && !selClients.includes(clientName)) return false;
      if (selDests.length > 0 && !selDests.includes(dest)) return false;
      if (selBreakouts.length > 0 && !selBreakouts.includes(breakout)) return false;
      return true;
    });
  }, [productCdrs, selClients, selDests, selBreakouts]);

  // ── Per-client aggregation ──────────────────────────────────────────────────
  const clientRows = useMemo(() => {
    const map = new Map<string, { calls: number; answered: number; minutes: number; cost: number; iAccount?: any }>();
    for (const c of filteredCdrs) {
      const name = c.clientName || (c.iAccount ? `Acct.${c.iAccount}` : 'Unknown');
      const row = map.get(name) ?? { calls: 0, answered: 0, minutes: 0, cost: 0, iAccount: c.iAccount };
      row.calls++;
      if ((c.duration || 0) > 0) row.answered++;
      row.minutes += (c.totalDuration || 0) / 60;
      row.cost += c.cost || 0;
      map.set(name, row);
    }
    return Array.from(map.entries())
      .map(([name, d]) => ({ name, ...d, asr: d.calls > 0 ? Math.round((d.answered / d.calls) * 100) : 0 }))
      .sort((a, b) => b.calls - a.calls);
  }, [filteredCdrs]);

  // ── Per-destination aggregation ─────────────────────────────────────────────
  const destRows = useMemo(() => {
    const map = new Map<string, { calls: number; answered: number; minutes: number; cost: number }>();
    for (const c of filteredCdrs) {
      const info = c.callee ? lookupCLD(c.callee) : null;
      const dest = info?.country ? `${info.country.flag} ${info.country.name}` : (c.country || '🌐 Unknown');
      const row = map.get(dest) ?? { calls: 0, answered: 0, minutes: 0, cost: 0 };
      row.calls++;
      if ((c.duration || 0) > 0) row.answered++;
      row.minutes += (c.totalDuration || 0) / 60;
      row.cost += c.cost || 0;
      map.set(dest, row);
    }
    return Array.from(map.entries())
      .map(([dest, d]) => ({ dest, ...d, asr: d.calls > 0 ? Math.round((d.answered / d.calls) * 100) : 0 }))
      .sort((a, b) => b.calls - a.calls);
  }, [filteredCdrs]);

  // ── Breakout aggregation ────────────────────────────────────────────────────
  const breakoutRows = useMemo(() => {
    const map = new Map<string, { calls: number; answered: number; minutes: number; cost: number }>();
    for (const c of filteredCdrs) {
      const type = classifyNetwork(c.callee || '');
      const row = map.get(type) ?? { calls: 0, answered: 0, minutes: 0, cost: 0 };
      row.calls++;
      if ((c.duration || 0) > 0) row.answered++;
      row.minutes += (c.totalDuration || 0) / 60;
      row.cost += c.cost || 0;
      map.set(type, row);
    }
    return Array.from(map.entries())
      .map(([type, d]) => ({ type, ...d, asr: d.calls > 0 ? Math.round((d.answered / d.calls) * 100) : 0 }))
      .sort((a, b) => b.calls - a.calls);
  }, [filteredCdrs]);

  // ── Per-client rate aggregation ─────────────────────────────────────────────
  const rateRows = useMemo(() => {
    return clientRows.map(r => ({
      ...r,
      ratePerMin: r.minutes > 0 ? (r.cost / r.minutes) : 0,
    })).sort((a, b) => b.ratePerMin - a.ratePerMin);
  }, [clientRows]);

  const totalCalls = filteredCdrs.length;

  const TABS: { key: IntelTab; label: string; icon: React.ReactNode }[] = [
    { key: 'clients',      label: 'Clients',     icon: <Users className="h-3.5 w-3.5" /> },
    { key: 'destinations', label: 'Destinations', icon: <Globe className="h-3.5 w-3.5" /> },
    { key: 'breakout',     label: 'Breakout',     icon: <Network className="h-3.5 w-3.5" /> },
    { key: 'rates',        label: 'Rates',        icon: <DollarSign className="h-3.5 w-3.5" /> },
    { key: 'minutes',      label: 'Minutes',      icon: <Timer className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-background/50 overflow-hidden shadow-lg">
      {/* Panel header */}
      <div className={cn("px-4 py-2.5 border-b border-border/50 flex items-center gap-3 flex-wrap", cls.bg)}>
        <span className={cn("text-xs font-bold uppercase tracking-wide", cls.color)}>
          {cls.label} — Intelligence Panel
        </span>
        <span className="text-xs text-muted-foreground">
          {productCdrs.length.toLocaleString()} CDRs
          {filteredCdrs.length !== productCdrs.length && ` → ${filteredCdrs.length.toLocaleString()} after filters`}
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* Combined filters */}
          <MultiSelect
            options={allClients}
            selected={selClients}
            onChange={setSelClients}
            placeholder="All Clients"
            testId={`multiselect-clients-${cls.prefix}`}
          />
          <MultiSelect
            options={allDests}
            selected={selDests}
            onChange={setSelDests}
            placeholder="All Destinations"
            testId={`multiselect-dests-${cls.prefix}`}
          />
          <MultiSelect
            options={allBreakouts}
            selected={selBreakouts}
            onChange={setSelBreakouts}
            placeholder="All Breakouts"
            testId={`multiselect-breakouts-${cls.prefix}`}
          />
          {(selClients.length + selDests.length + selBreakouts.length) > 0 && (
            <button
              onClick={() => { setSelClients([]); setSelDests([]); setSelBreakouts([]); }}
              className="h-7 px-2 rounded-md text-[10px] text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-border/80 transition-colors flex items-center gap-1"
            >
              <X className="h-2.5 w-2.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-border/50 bg-muted/20">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            data-testid={`tab-intel-${t.key}-${cls.prefix}`}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors",
              tab === t.key
                ? `border-current ${cls.color} bg-background/60`
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        {/* CLIENTS tab */}
        {tab === 'clients' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border/50 bg-muted/40">
                <th className="px-4 py-2 text-left text-muted-foreground font-medium">Client / Account</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">Calls</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">ASR</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">Minutes</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">Cost (USD)</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {clientRows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground italic">No data for selected filters</td></tr>
              )}
              {clientRows.map((r, i) => {
                const share = totalCalls > 0 ? (r.calls / totalCalls) * 100 : 0;
                return (
                  <tr key={r.name} className="border-b border-border/20 hover:bg-muted/20 transition-colors"
                    data-testid={`row-client-${cls.prefix}-${i}`}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", cls.dot)} />
                        <span className="font-medium truncate max-w-[200px]">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">{r.calls.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={cn("font-semibold tabular-nums",
                        r.asr >= 60 ? "text-emerald-400" : r.asr >= 30 ? "text-amber-400" : "text-red-400")}>
                        {r.asr}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-foreground/70">{r.minutes.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right font-mono text-amber-400">${r.cost.toFixed(4)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full rounded-full", cls.dot)} style={{ width: `${share}%` }} />
                        </div>
                        <span className="text-muted-foreground w-8 tabular-nums text-right">{share.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* DESTINATIONS tab */}
        {tab === 'destinations' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border/50 bg-muted/40">
                <th className="px-4 py-2 text-left text-muted-foreground font-medium">Destination</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">Calls</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">ASR</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">Minutes</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">Cost (USD)</th>
                <th className="px-4 py-2 text-right text-muted-foreground font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {destRows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground italic">No data for selected filters</td></tr>
              )}
              {destRows.map((r, i) => {
                const share = totalCalls > 0 ? (r.calls / totalCalls) * 100 : 0;
                return (
                  <tr key={r.dest} className="border-b border-border/20 hover:bg-muted/20 transition-colors"
                    data-testid={`row-dest-${cls.prefix}-${i}`}>
                    <td className="px-4 py-2 font-medium">{r.dest}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">{r.calls.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={cn("font-semibold tabular-nums",
                        r.asr >= 60 ? "text-emerald-400" : r.asr >= 30 ? "text-amber-400" : "text-red-400")}>
                        {r.asr}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-foreground/70">{r.minutes.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right font-mono text-amber-400">${r.cost.toFixed(4)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full rounded-full", cls.dot)} style={{ width: `${share}%` }} />
                        </div>
                        <span className="text-muted-foreground w-8 tabular-nums text-right">{share.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* BREAKOUT tab */}
        {tab === 'breakout' && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b border-border/30">
              {breakoutRows.map(r => {
                const meta = NETWORK_META[r.type] ?? NETWORK_META.Landline;
                const share = totalCalls > 0 ? (r.calls / totalCalls) * 100 : 0;
                return (
                  <div key={r.type} className={cn("rounded-lg border p-3 space-y-1.5", meta.bg, "border-border/40")}
                    data-testid={`card-breakout-${r.type}-${cls.prefix}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-base">{meta.icon}</span>
                      <span className={cn("text-xs font-bold", meta.color)}>{r.type}</span>
                    </div>
                    <p className="text-lg font-bold tabular-nums">{r.calls.toLocaleString()}</p>
                    <p className="text-[11px] text-muted-foreground">calls · {share.toFixed(1)}%</p>
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      <div>
                        <p className="text-muted-foreground">ASR</p>
                        <p className={cn("font-semibold", r.asr >= 60 ? "text-emerald-400" : r.asr >= 30 ? "text-amber-400" : "text-red-400")}>
                          {r.asr}%
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Min</p>
                        <p className="font-mono font-semibold">{r.minutes.toFixed(0)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {breakoutRows.length === 0 && (
                <div className="col-span-4 py-6 text-center text-muted-foreground text-xs italic">No data for selected filters</div>
              )}
            </div>
            {/* Detail table */}
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border/50 bg-muted/40">
                  <th className="px-4 py-2 text-left text-muted-foreground font-medium">Network Type</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Calls</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Answered</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">ASR</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Minutes</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Cost (USD)</th>
                </tr>
              </thead>
              <tbody>
                {breakoutRows.map(r => {
                  const meta = NETWORK_META[r.type] ?? NETWORK_META.Landline;
                  return (
                    <tr key={r.type} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2">
                        <span className={cn("flex items-center gap-2", meta.color)}>
                          <span>{meta.icon}</span>
                          <span className="font-semibold">{r.type}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">{r.calls.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono text-emerald-400">{r.answered.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">
                        <span className={cn("font-semibold", r.asr >= 60 ? "text-emerald-400" : r.asr >= 30 ? "text-amber-400" : "text-red-400")}>
                          {r.asr}%
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-foreground/70">{r.minutes.toFixed(1)}</td>
                      <td className="px-4 py-2 text-right font-mono text-amber-400">${r.cost.toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {/* RATES tab — effective rate per client */}
        {tab === 'rates' && (
          <>
            <div className="px-4 py-2.5 border-b border-border/30 bg-muted/10 flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Effective rate per minute calculated from actual CDR cost ÷ billed minutes per client
              </span>
            </div>
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border/50 bg-muted/40">
                  <th className="px-4 py-2 text-left text-muted-foreground font-medium">Client</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Calls</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Minutes</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Total Cost</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Rate / Min</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Rate Band</th>
                </tr>
              </thead>
              <tbody>
                {rateRows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground italic">No data for selected filters</td></tr>
                )}
                {rateRows.map((r, i) => {
                  const band = r.ratePerMin >= 0.05 ? 'High' : r.ratePerMin >= 0.02 ? 'Mid' : r.ratePerMin > 0 ? 'Low' : 'Free';
                  const bandColor = band === 'High' ? 'text-rose-400 bg-rose-500/10' : band === 'Mid' ? 'text-amber-400 bg-amber-500/10' : band === 'Low' ? 'text-emerald-400 bg-emerald-500/10' : 'text-muted-foreground bg-muted/30';
                  return (
                    <tr key={r.name} className="border-b border-border/20 hover:bg-muted/20 transition-colors"
                      data-testid={`row-rate-${cls.prefix}-${i}`}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", cls.dot)} />
                          <span className="font-medium truncate max-w-[180px]">{r.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{r.calls.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono text-foreground/70">{r.minutes.toFixed(1)}</td>
                      <td className="px-4 py-2 text-right font-mono text-amber-400">${r.cost.toFixed(4)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-primary">
                        ${r.ratePerMin.toFixed(5)}/min
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", bandColor)}>
                          {band}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {/* MINUTES tab */}
        {tab === 'minutes' && (
          <>
            <div className="px-4 py-2.5 border-b border-border/30 bg-muted/10 flex items-center gap-2">
              <Timer className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Traffic volume contribution per client — apply Client + Destination filters above to narrow scope
              </span>
            </div>
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border/50 bg-muted/40">
                  <th className="px-4 py-2 text-left text-muted-foreground font-medium">Client</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Calls</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">ASR</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Total Min</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Avg Dur</th>
                  <th className="px-4 py-2 text-right text-muted-foreground font-medium">Volume Share</th>
                </tr>
              </thead>
              <tbody>
                {clientRows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground italic">No data for selected filters</td></tr>
                )}
                {(() => {
                  const totalMin = clientRows.reduce((a, r) => a + r.minutes, 0);
                  return clientRows
                    .slice()
                    .sort((a, b) => b.minutes - a.minutes)
                    .map((r, i) => {
                      const volShare = totalMin > 0 ? (r.minutes / totalMin) * 100 : 0;
                      const avgDur = r.calls > 0 ? (r.minutes * 60) / r.calls : 0;
                      return (
                        <tr key={r.name} className="border-b border-border/20 hover:bg-muted/20 transition-colors"
                          data-testid={`row-minutes-${cls.prefix}-${i}`}>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", cls.dot)} />
                              <span className="font-medium truncate max-w-[180px]">{r.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right font-mono">{r.calls.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right">
                            <span className={cn("font-semibold",
                              r.asr >= 60 ? "text-emerald-400" : r.asr >= 30 ? "text-amber-400" : "text-red-400")}>
                              {r.asr}%
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-bold">{r.minutes.toFixed(1)}</td>
                          <td className="px-4 py-2 text-right font-mono text-foreground/70">
                            {fmtDurSec(avgDur)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div className={cn("h-full rounded-full", cls.dot)} style={{ width: `${volShare}%` }} />
                              </div>
                              <span className="text-muted-foreground w-9 text-right tabular-nums">{volShare.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                })()}
              </tbody>
              {clientRows.length > 0 && (
                <tfoot className="sticky bottom-0">
                  <tr className="border-t border-border/50 bg-muted/30">
                    <td className="px-4 py-2 font-semibold">Total</td>
                    <td className="px-4 py-2 text-right font-mono font-bold">{filteredCdrs.length.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {filteredCdrs.length > 0
                        ? `${Math.round((filteredCdrs.filter(c => (c.duration||0) > 0).length / filteredCdrs.length) * 100)}%`
                        : '0%'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-bold">
                      {clientRows.reduce((a, r) => a + r.minutes, 0).toFixed(1)}
                    </td>
                    <td />
                    <td className="px-4 py-2 text-right text-muted-foreground text-[11px]">100%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ── Product document sections ─────────────────────────────────────────────────
const DOC_SECTIONS = [
  'Overview', 'Service Description', 'SLA', 'Technical Specs',
  'Pricing', 'Pricing Terms', 'Compliance', 'Notes', 'Other',
] as const;

// ── Product Docs types ─────────────────────────────────────────────────────────
interface ProductDoc {
  id: number;
  productPrefix: string;
  title: string;
  section: string;
  content: string;
  sortOrder: number;
  updatedBy?: string;
  updatedAt?: string;
  createdAt?: string;
}

// ── DocEditor modal ────────────────────────────────────────────────────────────
function DocEditorModal({
  open, onClose, doc, productPrefix, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  doc: ProductDoc | null;
  productPrefix: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle]     = useState('');
  const [section, setSection] = useState('Overview');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (open) {
      setTitle(doc?.title ?? '');
      setSection(doc?.section ?? 'Overview');
      setContent(doc?.content ?? '');
    }
  }, [open, doc]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (doc) {
        return apiRequest('PUT', `/api/product-docs/${doc.id}`, { title, section, content });
      }
      return apiRequest('POST', '/api/product-docs', { productPrefix, title, section, content });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/product-docs'] });
      toast({ title: doc ? 'Document updated' : 'Document created', description: title });
      onSaved();
      onClose();
    },
    onError: (e: any) => {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            {doc ? 'Edit Document' : 'New Document'}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input
                data-testid="input-doc-title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. First Class SLA Agreement"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Section</label>
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger data-testid="select-doc-section" className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_SECTIONS.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Content <span className="text-muted-foreground/50">(markdown supported)</span>
            </label>
            <Textarea
              data-testid="textarea-doc-content"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Write documentation here… Markdown is rendered in the view."
              className="text-sm font-mono min-h-[280px] resize-y"
            />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0 flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saveMut.isPending}>
            Cancel
          </Button>
          <Button
            data-testid="button-save-doc"
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !title.trim()}
          >
            {saveMut.isPending ? (
              <><RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving…</>
            ) : (
              <><Save className="h-3.5 w-3.5 mr-1.5" /> Save</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Docs Tab component ────────────────────────────────────────────────────────
function DocsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedPrefix, setSelectedPrefix] = useState('1');
  const [editorOpen, setEditorOpen]         = useState(false);
  const [editingDoc, setEditingDoc]         = useState<ProductDoc | null>(null);
  const [expandedId, setExpandedId]         = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ docs: ProductDoc[] }>({
    queryKey: ['/api/product-docs', selectedPrefix],
    queryFn: () => fetch(`/api/product-docs?prefix=${selectedPrefix}`).then(r => r.json()),
    staleTime: 30_000,
  });
  const docs = data?.docs ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/product-docs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/product-docs'] });
      toast({ title: 'Document deleted' });
    },
    onError: (e: any) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  });

  // Group docs by section
  const grouped = useMemo(() => {
    const map = new Map<string, ProductDoc[]>();
    for (const doc of docs) {
      const arr = map.get(doc.section) ?? [];
      arr.push(doc);
      map.set(doc.section, arr);
    }
    return map;
  }, [docs]);

  const activeCls = PRODUCT_CLASSES.find(c => c.prefix === selectedPrefix)!;

  // Simple markdown → readable text renderer (strip markup for preview)
  const previewText = (content: string, maxLen = 140) => {
    const plain = content.replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').replace(/\n/g, ' ').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain || '(no content)';
  };

  // Simple markdown renderer for expanded view
  const renderMarkdown = (content: string) => {
    if (!content) return <p className="text-muted-foreground italic text-sm">No content yet.</p>;
    return content.split('\n').map((line, i) => {
      if (line.startsWith('### ')) return <h3 key={i} className="text-sm font-bold mt-3 mb-1 text-foreground">{line.slice(4)}</h3>;
      if (line.startsWith('## '))  return <h2 key={i} className="text-base font-bold mt-4 mb-1 text-foreground">{line.slice(3)}</h2>;
      if (line.startsWith('# '))   return <h1 key={i} className="text-lg font-bold mt-4 mb-2 text-foreground">{line.slice(2)}</h1>;
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return <li key={i} className="ml-4 text-sm text-foreground/80 list-disc">{line.slice(2)}</li>;
      }
      if (line.trim() === '') return <br key={i} />;
      // Bold: **text**
      const parts = line.split(/\*\*(.+?)\*\*/g);
      return <p key={i} className="text-sm text-foreground/80 leading-relaxed">
        {parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part)}
      </p>;
    });
  };

  return (
    <div className="flex gap-0 h-full min-h-[600px]">
      {/* Left sidebar — product selector */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5" /> Products
          </p>
        </div>
        <div className="flex-1 p-2 space-y-1">
          {PRODUCT_CLASSES.filter(c => c.prefix !== 'other').map(cls => {
            const count = docs.filter(d => d.productPrefix === cls.prefix).length;
            const isActive = selectedPrefix === cls.prefix;
            return (
              <button
                key={cls.prefix}
                data-testid={`button-product-${cls.prefix}`}
                onClick={() => setSelectedPrefix(cls.prefix)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm transition-colors",
                  isActive
                    ? cn("font-semibold", cls.bg, cls.color)
                    : "hover:bg-muted/50 text-foreground/70"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full shrink-0", cls.dot)} />
                <span className="flex-1 truncate">{cls.short}</span>
                {count > 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                    isActive ? "bg-background/30 text-current" : "bg-muted text-muted-foreground"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right panel — docs for selected product */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-3 shrink-0">
          <span className={cn("h-2.5 w-2.5 rounded-full", activeCls?.dot)} />
          <div className="flex-1 min-w-0">
            <h2 className={cn("text-sm font-semibold", activeCls?.color)}>{activeCls?.label}</h2>
            <p className="text-xs text-muted-foreground">
              {docs.length} document{docs.length !== 1 ? 's' : ''} •&nbsp;
              {grouped.size} section{grouped.size !== 1 ? 's' : ''}
            </p>
          </div>
          <Button
            data-testid="button-new-doc"
            size="sm"
            onClick={() => { setEditingDoc(null); setEditorOpen(true); }}
            className="shrink-0"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Document
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
            </div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <BookOpen className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No documents yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1 mb-4">
                Add SLA specs, pricing terms, technical notes and more for {activeCls?.label}.
              </p>
              <Button
                data-testid="button-new-doc-empty"
                size="sm" variant="outline"
                onClick={() => { setEditingDoc(null); setEditorOpen(true); }}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Create First Document
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(grouped.entries()).map(([sectionName, sectionDocs]) => (
                <div key={sectionName}>
                  {/* Section header */}
                  <div className="flex items-center gap-2 mb-3">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{sectionName}</span>
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] text-muted-foreground/50">{sectionDocs.length}</span>
                  </div>
                  {/* Docs in section */}
                  <div className="space-y-2">
                    {sectionDocs.map(doc => {
                      const isExpanded = expandedId === doc.id;
                      return (
                        <div
                          key={doc.id}
                          data-testid={`card-doc-${doc.id}`}
                          className="border border-border rounded-xl overflow-hidden bg-card"
                        >
                          {/* Doc header row */}
                          <div
                            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                            onClick={() => setExpandedId(isExpanded ? null : doc.id)}
                          >
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{doc.title}</p>
                              {!isExpanded && (
                                <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{previewText(doc.content)}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                data-testid={`button-edit-doc-${doc.id}`}
                                variant="ghost" size="icon"
                                className="h-6 w-6"
                                onClick={e => { e.stopPropagation(); setEditingDoc(doc); setEditorOpen(true); }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                data-testid={`button-delete-doc-${doc.id}`}
                                variant="ghost" size="icon"
                                className="h-6 w-6 text-destructive hover:text-destructive"
                                onClick={e => {
                                  e.stopPropagation();
                                  if (confirm(`Delete "${doc.title}"?`)) deleteMut.mutate(doc.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                              <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                            </div>
                          </div>
                          {/* Expanded content */}
                          {isExpanded && (
                            <div className="border-t border-border px-5 py-4 bg-muted/10">
                              <div className="prose prose-sm max-w-none space-y-1">
                                {renderMarkdown(doc.content)}
                              </div>
                              {doc.updatedAt && (
                                <p className="text-[10px] text-muted-foreground/50 mt-4 pt-3 border-t border-border/50">
                                  Last updated {new Date(doc.updatedAt).toLocaleString()}
                                  {doc.updatedBy && ` by ${doc.updatedBy}`}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Editor modal */}
      <DocEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        doc={editingDoc}
        productPrefix={selectedPrefix}
        onSaved={() => qc.invalidateQueries({ queryKey: ['/api/product-docs'] })}
      />
    </div>
  );
}

// ── Range options ─────────────────────────────────────────────────────────────
const RANGE_OPTIONS = [
  { label: 'Last 1 hour',  key: '1h',     fn: () => [subHoursUTC(new Date(), 1),   new Date()] },
  { label: 'Last 6 hours', key: '6h',     fn: () => [subHoursUTC(new Date(), 6),   new Date()] },
  { label: 'Last 24 hours',key: '24h',    fn: () => [subHoursUTC(new Date(), 24),  new Date()] },
  { label: 'Today',        key: 'today',  fn: () => [startOfDayUTC(new Date()),     new Date()] },
  { label: 'Yesterday',    key: 'yesterday', fn: () => [startOfDayUTC(subDaysUTC(new Date(), 1)), endOfDayUTC(subDaysUTC(new Date(), 1))] },
  { label: 'This week',    key: 'week',   fn: () => [startOfWeekUTC(new Date()),    new Date()] },
  { label: 'Last week',    key: 'lweek',  fn: () => [startOfWeekUTC(subWeeksUTC(new Date(), 1)), endOfWeekUTC(subWeeksUTC(new Date(), 1))] },
  { label: 'This month',   key: 'month',  fn: () => [startOfMonthUTC(new Date()),   new Date()] },
  { label: 'Last month',   key: 'lmonth', fn: () => [startOfMonthUTC(subMonthsUTC(new Date(), 1)), endOfMonthUTC(subMonthsUTC(new Date(), 1))] },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ProductsPage() {
  const { tz } = useTimezone();
  const [pageTab, setPageTab]             = useState<'analytics' | 'docs'>('analytics');
  const [rangeKey, setRangeKey]           = useState('24h');
  const [expandedPrefix, setExpandedPrefix] = useState<string | null>(null);

  const [start, end] = useMemo(() => {
    const opt = RANGE_OPTIONS.find(o => o.key === rangeKey) ?? RANGE_OPTIONS[2];
    return opt.fn() as [Date, Date];
  }, [rangeKey]);

  const params = new URLSearchParams({
    startDate: start.toISOString(),
    endDate:   end.toISOString(),
    type:      'all',
    limit:     '2000',
    offset:    '0',
  });
  const queryKey = ['/api/sippy/cdr', 'products', start.toISOString(), end.toISOString()];

  const { data, isLoading, isFetching, refetch } = useQuery<{ cdrs: any[] }>({
    queryKey,
    queryFn: () => fetch(`/api/sippy/cdr?${params.toString()}`).then(r => r.json()),
    staleTime: 60_000,
  });

  const cdrs = data?.cdrs || [];

  const stats = useMemo(() => {
    const buckets: Record<string, ProductStats> = {
      '1': emptyStats(), '2': emptyStats(), '6': emptyStats(),
      '7': emptyStats(), 'other': emptyStats(),
    };
    for (const c of cdrs) {
      const cldInfo = c.callee ? lookupCLD(c.callee) : null;
      const prefix: string = cldInfo?.trunkPrefix ?? 'other';
      const bucket = buckets[prefix] ?? buckets['other'];
      const countryName = cldInfo?.country ? `${cldInfo.country.flag} ${cldInfo.country.name}` : (c.country || 'Unknown');
      bucket.calls++;
      if ((c.duration || 0) > 0) bucket.answered++;
      bucket.totalDuration += c.totalDuration || 0;
      bucket.billedDuration += c.duration || 0;
      bucket.cost += c.cost || 0;
      bucket.topCountries[countryName] = (bucket.topCountries[countryName] || 0) + 1;
    }
    return buckets as Record<ProductPrefix, ProductStats>;
  }, [cdrs]);

  const totalCalls = cdrs.length;
  const classifiedCalls = Object.entries(stats)
    .filter(([k]) => k !== 'other')
    .reduce((acc, [, v]) => acc + v.calls, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">Product Classification</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-primary/10 border-primary/30 text-primary">
              <Package className="h-3 w-3" />
              Sippy Trunk Classes
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            CDR breakdown by product / trunk class — first digit of CLD encodes the service tier.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 bg-muted/50 border border-border rounded-lg p-0.5">
            <button
              data-testid="tab-analytics"
              onClick={() => setPageTab('analytics')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                pageTab === 'analytics'
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart3 className="h-3.5 w-3.5" /> Analytics
            </button>
            <button
              data-testid="tab-docs"
              onClick={() => setPageTab('docs')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                pageTab === 'docs'
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BookOpen className="h-3.5 w-3.5" /> Documents
            </button>
          </div>
          {pageTab === 'analytics' && (
            <>
              <Select value={rangeKey} onValueChange={setRangeKey}>
                <SelectTrigger className="h-8 text-xs w-36" data-testid="select-product-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map(o => (
                    <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline" size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-products-refresh"
              >
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
                Refresh
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Documents tab ─────────────────────────────────────────────────── */}
      {pageTab === 'docs' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <DocsTab />
        </div>
      )}

      {/* ── Analytics tab ─────────────────────────────────────────────────── */}
      {pageTab === 'analytics' && <>

      {/* Legend row */}
      <div className="flex flex-wrap gap-3">
        {PRODUCT_CLASSES.map(cls => (
          <div
            key={cls.prefix}
            className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium", cls.bg, cls.color)}
          >
            <span className={cn("h-2 w-2 rounded-full", cls.dot)} />
            <span className="font-mono text-[11px] opacity-70">
              {cls.prefix === 'other' ? '?' : cls.prefix}
            </span>
            {cls.label}
          </div>
        ))}
      </div>

      {/* KPI Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
        {PRODUCT_CLASSES.map(cls => {
          const s = stats[cls.prefix as ProductPrefix] ?? emptyStats();
          const asr = s.calls > 0 ? Math.round((s.answered / s.calls) * 100) : 0;
          const pct = totalCalls > 0 ? Math.round((s.calls / totalCalls) * 100) : 0;
          const isExpanded = expandedPrefix === cls.prefix;

          return (
            <div key={cls.prefix} className="flex flex-col">
              <button
                onClick={() => setExpandedPrefix(isExpanded ? null : cls.prefix)}
                className={cn(
                  "rounded-xl border p-4 space-y-3 text-left transition-all duration-200 w-full",
                  "hover:shadow-md hover:scale-[1.01] active:scale-100",
                  cls.bg,
                  isExpanded && `ring-2 ${cls.ring} shadow-md`
                )}
                data-testid={`card-product-${cls.prefix}`}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("text-xs font-semibold uppercase tracking-wide", cls.color)}>
                    {cls.short}
                  </span>
                  <div className="flex items-center gap-2">
                    {cls.prefix !== 'other' && (
                      <span className={cn(
                        "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border",
                        cls.bg, cls.color
                      )}>
                        PREFIX: {cls.prefix}
                      </span>
                    )}
                    <span className={cn("text-muted-foreground transition-transform", isExpanded ? "rotate-180" : "")}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground font-medium leading-tight">{cls.label}</p>

                {isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-7 w-24" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-2xl font-bold tabular-nums" data-testid={`stat-calls-${cls.prefix}`}>
                        {s.calls.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">calls ({pct}% of total)</p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">ASR</span>
                        <span className={cn("font-semibold", asr >= 60 ? "text-emerald-400" : asr >= 30 ? "text-amber-400" : "text-red-400")}>
                          {asr}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-background/40 overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", asr >= 60 ? "bg-emerald-500" : asr >= 30 ? "bg-amber-500" : "bg-red-500")}
                          style={{ width: `${asr}%` }}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Duration</p>
                        <p className="font-mono font-semibold">{fmtDurSec(s.totalDuration)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Charged</p>
                        <p className="font-mono font-semibold text-amber-400">${s.cost.toFixed(4)}</p>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className={cn("text-[10px] font-medium text-center py-0.5 rounded", cls.color, cls.bg)}>
                        ▲ Intelligence Panel Open
                      </div>
                    )}
                  </>
                )}
              </button>

              {/* Intelligence panel — renders below each card */}
              {isExpanded && !isLoading && (
                <IntelPanel cls={cls} cdrs={cdrs} />
              )}
            </div>
          );
        })}
      </div>

      {/* Detailed comparison table */}
      <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/50 bg-muted/20 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Product Class Comparison</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatUTC(start, 'dd MMM yyyy')} → {formatUTC(end, 'dd MMM yyyy')}
            {' '}· {totalCalls.toLocaleString()} total calls
            {totalCalls > 0 && ` (${classifiedCalls.toLocaleString()} classified)`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Product Class</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Calls</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Answered</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">ASR</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Duration</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Billed</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Charged (USD)</th>
                <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/20">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-2.5"><Skeleton className="h-3 w-full" /></td>
                      ))}
                    </tr>
                  ))
                : PRODUCT_CLASSES.map(cls => {
                    const s = stats[cls.prefix as ProductPrefix] ?? emptyStats();
                    const asr = s.calls > 0 ? Math.round((s.answered / s.calls) * 100) : 0;
                    const pct = totalCalls > 0 ? ((s.calls / totalCalls) * 100).toFixed(1) : '0.0';
                    return (
                      <tr
                        key={cls.prefix}
                        className="border-b border-border/20 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setExpandedPrefix(expandedPrefix === cls.prefix ? null : cls.prefix)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className={cn("h-2 w-2 rounded-full flex-shrink-0", cls.dot)} />
                            <span className={cn("font-semibold", cls.color)}>{cls.label}</span>
                            {cls.prefix !== 'other' && (
                              <span className="text-[10px] font-mono text-muted-foreground/50 ml-1">
                                (digit: {cls.prefix})
                              </span>
                            )}
                            {expandedPrefix === cls.prefix && (
                              <span className="text-[10px] text-primary font-medium ml-1">▲ open</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">{s.calls.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{s.answered.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={cn("font-semibold tabular-nums",
                            asr >= 60 ? "text-emerald-400" : asr >= 30 ? "text-amber-400" : "text-red-400")}>
                            {asr}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-foreground/70">{fmtDurSec(s.totalDuration)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-blue-400">{fmtDurSec(s.billedDuration)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-amber-400 font-semibold">${s.cost.toFixed(4)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-background/40 overflow-hidden">
                              <div className={cn("h-full rounded-full", cls.dot)} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-muted-foreground w-9 text-right tabular-nums">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
            {!isLoading && totalCalls > 0 && (
              <tfoot>
                <tr className="border-t border-border/50 bg-muted/20">
                  <td className="px-4 py-2.5 font-semibold">Total</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold">{totalCalls.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-400 font-bold">
                    {Object.values(stats).reduce((a, s) => a + s.answered, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold">
                    {(() => {
                      const totalAnswered = Object.values(stats).reduce((a, s) => a + s.answered, 0);
                      return totalCalls > 0 ? `${Math.round((totalAnswered / totalCalls) * 100)}%` : '0%';
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold">
                    {fmtDurSec(Object.values(stats).reduce((a, s) => a + s.totalDuration, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-blue-400">
                    {fmtDurSec(Object.values(stats).reduce((a, s) => a + s.billedDuration, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-amber-400">
                    ${Object.values(stats).reduce((a, s) => a + s.cost, 0).toFixed(4)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground text-[11px]">100%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Top countries per class */}
        {!isLoading && totalCalls > 0 && (
          <div className="border-t border-border/50 p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Top Destinations per Product Class
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {PRODUCT_CLASSES.filter(cls => cls.prefix !== 'other').map(cls => {
                const s = stats[cls.prefix as ProductPrefix];
                const topEntries = Object.entries(s.topCountries)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5);
                return (
                  <div key={cls.prefix} className="space-y-1.5">
                    <p className={cn("text-xs font-semibold", cls.color)}>{cls.short}</p>
                    {topEntries.length === 0 ? (
                      <p className="text-xs text-muted-foreground/50 italic">No traffic</p>
                    ) : (
                      topEntries.map(([country, count]) => (
                        <div key={country} className="flex items-center justify-between text-xs gap-2">
                          <span className="text-foreground/70 truncate">{country}</span>
                          <span className="font-mono text-muted-foreground flex-shrink-0">{count.toLocaleString()}</span>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      </>}  {/* end analytics tab */}
    </div>
  );
}
