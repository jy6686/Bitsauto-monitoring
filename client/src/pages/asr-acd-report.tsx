import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Download, BarChart3, TrendingUp, TrendingDown,
  ChevronDown, Check, AlertCircle, Activity, Shield, Clock,
  Zap, AlertTriangle, CheckCircle2, XCircle, Info
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toUtcText(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function parseUtcText(s: string): Date | null {
  if (!s) return null;
  const normalised = s.trim().replace("T", " ");
  const m = normalised.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, yyyy, mm, dd, hh, min] = m.map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min, 0));
  return isNaN(d.getTime()) ? null : d;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtMins(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ── Benchmark thresholds (wholesale VoIP industry standards) ─────────────────
const BENCH = {
  asr:  { critical: 10, warning: 20, good: 35 },   // %
  ner:  { critical: 30, warning: 50, good: 65 },   // %
  acd:  { critical: 60, warning: 120, good: 180 }, // seconds
  pdd:  { critical: 8, warning: 5, good: 3 },      // seconds (lower = better)
  fas:  { critical: 10, warning: 5, good: 2 },     // % (lower = better)
};

type QualityLevel = "critical" | "warning" | "good" | "neutral";

function asrQuality(asr: number, totalCalls: number): QualityLevel {
  if (totalCalls === 0) return "neutral";
  if (asr < BENCH.asr.critical) return "critical";
  if (asr < BENCH.asr.warning)  return "warning";
  return "good";
}

function nerQuality(ner: number, totalCalls: number): QualityLevel {
  if (totalCalls === 0) return "neutral";
  if (ner < BENCH.ner.critical) return "critical";
  if (ner < BENCH.ner.warning)  return "warning";
  return "good";
}

function fasQuality(fas: number, billable: number): QualityLevel {
  if (billable === 0) return "neutral";
  if (fas > BENCH.fas.critical) return "critical";
  if (fas > BENCH.fas.warning)  return "warning";
  return "good";
}

const QUALITY_BADGE: Record<QualityLevel, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  warning:  "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  good:     "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  neutral:  "bg-muted/40 text-muted-foreground border-border",
};

const QUALITY_BAR: Record<QualityLevel, string> = {
  critical: "bg-red-500",
  warning:  "bg-amber-400",
  good:     "bg-emerald-500",
  neutral:  "bg-muted",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportRow {
  name: string;
  totalCalls: number;
  billableCalls: number;
  durationSec: number;
  acdSec: number;
  asr: number;
  avgPdd: number;
  amount: number;
  nerPct?: number | null;
  fasRate?: number | null;
  rnaCount?: number;
  iVendor?: number;
  iConnection?: number;
}

interface EnrichmentMeta {
  sampleSize:       number;
  nativeTotalCalls: number;
  coverageRatio:    number;
  coveragePct:      number;
  confidence:       'high' | 'medium' | 'low' | 'suppressed';
}

interface ReportData {
  ok: boolean;
  highlightBelow: number;
  generatedAt: string;
  cdrCount: number;
  origination: ReportRow[];
  termination: ReportRow[];
  origTotal: ReportRow;
  termTotal: ReportRow;
  source?: string;
  degraded?: boolean;
  degradedReason?: string;
  enrichmentMeta?: EnrichmentMeta;
}

interface FilterState {
  startTime: string;
  endTime:   string;
  cli:            string;
  cld:            string;
  groupOrig:      string;
  groupTerm:      string;
  accountFilter:  string;
  vendorFilter:   string;
  sortOrig:       string;
  sortTerm:       string;
  hideOrigEmpty:  boolean;
  hideTermEmpty:  boolean;
  highlightBelow: string;
  currency:       string;
}

// ── Searchable combobox ────────────────────────────────────────────────────────

interface ComboboxProps {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  placeholder: string;
  emptyLabel: string;
  "data-testid"?: string;
}

function Combobox({ value, onChange, options, placeholder, emptyLabel, "data-testid": tid }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-testid={tid}
        onClick={() => setOpen(p => !p)}
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground ml-1" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-md border border-border bg-popover shadow-lg">
          <div className="p-1.5 border-b border-border">
            <Input autoFocus className="h-7 text-xs" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            <button type="button" onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors">
              {!value && <Check className="h-3 w-3" />}{value && <span className="w-3" />}
              <span className="text-muted-foreground italic">{emptyLabel}</span>
            </button>
            {filtered.map(o => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); setSearch(""); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors">
                {value === o.value ? <Check className="h-3 w-3 text-primary" /> : <span className="w-3" />}
                <span className="truncate">{o.label}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground text-center">No results</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── UTC text input ─────────────────────────────────────────────────────────────

function UtcTextInput({ value, onChange, label, "data-testid": tid }: {
  value: string; onChange: (v: string) => void; label: string; "data-testid"?: string;
}) {
  const [local, setLocal]     = useState(value);
  const [touched, setTouched] = useState(false);
  useEffect(() => { setLocal(value); }, [value]);
  const isInvalid = touched && !parseUtcText(local);

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input type="text" className={cn("h-8 text-sm font-mono pr-7", isInvalid && "border-red-500 focus-visible:ring-red-400")}
          placeholder="YYYY-MM-DD HH:MM" value={local} data-testid={tid} autoComplete="off" spellCheck={false}
          onChange={e => {
            setLocal(e.target.value);
            const p = parseUtcText(e.target.value);
            if (p) onChange(toUtcText(p));
          }}
          onBlur={() => {
            setTouched(true);
            const p = parseUtcText(local);
            if (p) { const c = toUtcText(p); setLocal(c); onChange(c); }
          }}
        />
        {isInvalid && <AlertCircle className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500 pointer-events-none" />}
      </div>
      {isInvalid && <p className="text-[10px] text-red-500">Format: YYYY-MM-DD HH:MM</p>}
    </div>
  );
}

// ── Mini quality bar ──────────────────────────────────────────────────────────

function QualityBar({ pct, level, maxPct = 100 }: { pct: number; level: QualityLevel; maxPct?: number }) {
  const fill = Math.min(100, (pct / maxPct) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-xs font-mono font-semibold tabular-nums w-12 text-right", {
        "text-red-500 dark:text-red-400":     level === "critical",
        "text-amber-500 dark:text-amber-400": level === "warning",
        "text-emerald-600 dark:text-emerald-400": level === "good",
        "text-muted-foreground":               level === "neutral",
      })}>
        {pct.toFixed(1)}%
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-muted/50 min-w-[40px] max-w-[64px]">
        <div className={cn("h-full rounded-full transition-all", QUALITY_BAR[level])} style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, level, icon }: {
  label: string; value: string; sub?: string;
  level: QualityLevel; icon: React.ReactNode;
}) {
  const borderCls = {
    good:     "border-emerald-500/30 bg-emerald-500/5",
    warning:  "border-amber-500/30 bg-amber-500/5",
    critical: "border-red-500/30 bg-red-500/5",
    neutral:  "border-border bg-card",
  }[level];
  const iconCls = {
    good:     "text-emerald-500",
    warning:  "text-amber-500",
    critical: "text-red-500",
    neutral:  "text-muted-foreground",
  }[level];

  return (
    <div className={cn("rounded-lg border p-4 flex flex-col gap-1.5", borderCls)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
        <span className={cn("h-4 w-4", iconCls)}>{icon}</span>
      </div>
      <span className="text-2xl font-bold tabular-nums tracking-tight">{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── Quality legend ────────────────────────────────────────────────────────────

function BenchmarkLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wider">Industry benchmarks:</span>
      <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-red-500 inline-block" /> ASR &lt;{BENCH.asr.critical}%</span>
      <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-amber-400 inline-block" /> ASR {BENCH.asr.critical}–{BENCH.asr.warning}%</span>
      <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-emerald-500 inline-block" /> ASR &gt;{BENCH.asr.warning}%</span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-red-500 inline-block" /> NER &lt;{BENCH.ner.critical}%</span>
      <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-amber-400 inline-block" /> NER {BENCH.ner.critical}–{BENCH.ner.warning}%</span>
      <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-emerald-500 inline-block" /> NER &gt;{BENCH.ner.warning}%</span>
    </div>
  );
}

// ── Entity name cell ──────────────────────────────────────────────────────────

function EntityNameCell({ name, iVendor, iConnection }: { name: string; iVendor?: number; iConnection?: number }) {
  const slashIdx   = name.indexOf(' / ');
  const hasSlash   = slashIdx !== -1;
  const vendorPart = hasSlash ? name.slice(0, slashIdx) : name;
  const connPart   = hasSlash ? name.slice(slashIdx + 3) : null;

  const vendorEl = iVendor ? (
    <Link to={`/vendors?id=${iVendor}`} data-testid={`link-vendor-${iVendor}`}
      className="text-primary hover:underline underline-offset-2 transition-colors" onClick={e => e.stopPropagation()}>
      {vendorPart}
    </Link>
  ) : <span>{vendorPart}</span>;

  const connEl = connPart ? (
    iConnection ? (
      <Link to="/routing-manager?tab=connections" data-testid={`link-connection-${iConnection}`}
        className="text-muted-foreground hover:text-primary hover:underline underline-offset-2 transition-colors" onClick={e => e.stopPropagation()}>
        {connPart}
      </Link>
    ) : <span className="text-muted-foreground">{connPart}</span>
  ) : null;

  return (
    <span className="truncate block max-w-[240px]">
      {vendorEl}
      {connEl && <span className="text-muted-foreground/60 mx-1">/</span>}
      {connEl}
    </span>
  );
}

// ── Report table ──────────────────────────────────────────────────────────────

interface ReportTableProps {
  title: string;
  subtitle: string;
  rows: ReportRow[];
  total: ReportRow;
  amountLabel: string;
  nameLabel: string;
  threshold: number;
  icon: React.ReactNode;
  showNer?: boolean;
}

function ReportTable({ title, subtitle, rows, total, amountLabel, nameLabel, threshold, icon, showNer = true }: ReportTableProps) {
  return (
    <div className="rounded-lg border border-border overflow-hidden" data-testid={`section-${title.toLowerCase()}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
        <Badge variant="secondary" className="ml-auto text-xs">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={`table-${title.toLowerCase()}`}>
          <thead>
            <tr className="bg-muted/20 border-b border-border text-xs text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-semibold min-w-[180px]">{nameLabel}</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">Calls</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">Billable</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">Duration</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">ACD</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap min-w-[110px]">
                ASR %
                <span className="ml-1 text-[9px] font-normal text-muted-foreground/60 normal-case">≥{BENCH.asr.warning}% good</span>
              </th>
              {showNer && (
                <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap min-w-[110px]">
                  NER %
                  <span className="ml-1 text-[9px] font-normal text-muted-foreground/60 normal-case">≥{BENCH.ner.warning}% good</span>
                  <span className="ml-1 text-[8px] font-normal text-muted-foreground/40 italic">derived</span>
                </th>
              )}
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">PDD sec</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">
                FAS %
                <span className="ml-1 text-[8px] font-normal text-muted-foreground/40 italic">derived</span>
              </th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">{amountLabel}</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showNer ? 10 : 9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No data for the selected period and filters.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const aLvl = asrQuality(row.asr, row.totalCalls);
                const nLvl = row.nerPct != null ? nerQuality(row.nerPct, row.totalCalls) : "neutral";
                const fLvl = row.fasRate != null ? fasQuality(row.fasRate, row.billableCalls) : "neutral";
                const rowAlert = aLvl === "critical" || (row.nerPct != null && nLvl === "critical");
                return (
                  <tr key={i} data-testid={`row-${title.toLowerCase()}-${i}`}
                    className={cn(
                      "border-b border-border/50 transition-colors",
                      rowAlert
                        ? "bg-red-500/[0.04] hover:bg-red-500/[0.08] dark:bg-red-900/[0.12] dark:hover:bg-red-900/[0.18]"
                        : "hover:bg-muted/30"
                    )}>
                    <td className="px-4 py-2.5">
                      <EntityNameCell name={row.name} iVendor={row.iVendor} iConnection={row.iConnection} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">{row.totalCalls.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">{row.billableCalls.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs font-mono">{fmtDuration(row.durationSec)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs font-mono">{fmtDuration(row.acdSec)}</td>
                    {/* ASR with quality bar */}
                    <td className="px-3 py-2.5">
                      {row.totalCalls > 0
                        ? <QualityBar pct={row.asr} level={aLvl} maxPct={100} />
                        : <span className="text-muted-foreground/40 text-xs">—</span>}
                    </td>
                    {/* NER with quality bar */}
                    {showNer && (
                      <td className="px-3 py-2.5">
                        {row.totalCalls > 0 && row.nerPct != null
                          ? <QualityBar pct={row.nerPct} level={nLvl} maxPct={100} />
                          : <span className="text-muted-foreground/40 text-xs">—</span>}
                      </td>
                    )}
                    {/* PDD */}
                    <td className={cn("px-3 py-2.5 text-right tabular-nums text-xs font-mono", {
                      "text-red-500":    row.avgPdd > BENCH.pdd.critical,
                      "text-amber-500":  row.avgPdd > BENCH.pdd.warning && row.avgPdd <= BENCH.pdd.critical,
                      "text-emerald-600 dark:text-emerald-400": row.avgPdd > 0 && row.avgPdd <= BENCH.pdd.warning,
                    })}>
                      {row.avgPdd > 0 ? row.avgPdd.toFixed(2) : "—"}
                    </td>
                    {/* FAS */}
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      {row.billableCalls > 0 && row.fasRate != null ? (
                        <span className={cn("font-mono", {
                          "text-red-500":    fLvl === "critical",
                          "text-amber-500":  fLvl === "warning",
                          "text-muted-foreground": fLvl === "good" || fLvl === "neutral",
                        })}>
                          {row.fasRate.toFixed(1)}%
                        </span>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    {/* Amount */}
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      {row.amount > 0 ? `$${row.amount.toFixed(4)}` : <span className="text-muted-foreground/40">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Totals row */}
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-muted/40 border-t border-border text-xs font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{total.totalCalls.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{total.billableCalls.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-mono">{fmtDuration(total.durationSec)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-mono">{fmtDuration(total.acdSec)}</td>
                <td className="px-3 py-2.5">
                  {total.totalCalls > 0
                    ? <QualityBar pct={total.asr} level={asrQuality(total.asr, total.totalCalls)} />
                    : <span className="text-muted-foreground/40">—</span>}
                </td>
                {showNer && (
                  <td className="px-3 py-2.5">
                    {total.totalCalls > 0 && total.nerPct != null
                      ? <QualityBar pct={total.nerPct} level={nerQuality(total.nerPct, total.totalCalls)} />
                      : <span className="text-muted-foreground/40">—</span>}
                  </td>
                )}
                <td className="px-3 py-2.5 text-right tabular-nums font-mono">{total.avgPdd > 0 ? total.avgPdd.toFixed(2) : "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{total.billableCalls > 0 && total.fasRate != null ? `${total.fasRate.toFixed(1)}%` : "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{total.amount > 0 ? `$${total.amount.toFixed(4)}` : "—"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AsrAcdReportPage() {
  function defaultFilters(): FilterState {
    return {
      startTime:     "",
      endTime:       "",
      cli:           "",
      cld:           "",
      groupOrig:     "caller",
      groupTerm:     "connection",
      accountFilter: "",
      vendorFilter:  "",
      sortOrig:      "calls",
      sortTerm:      "calls",
      hideOrigEmpty: true,
      hideTermEmpty: true,
      highlightBelow: "10",
      currency:      "usd",
    };
  }

  const [filters, setFilters]     = useState<FilterState>(defaultFilters);
  const [submitted, setSubmitted] = useState<FilterState | null>(null);
  const [enabled, setEnabled]     = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [relFrom, setRelFrom]     = useState("90");
  const [relTo, setRelTo]         = useState("0");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const vendor = p.get('vendor');
    const from   = parseInt(p.get('from') ?? '', 10);
    const to     = parseInt(p.get('to')   ?? '', 10);
    if (vendor) setFilters(prev => ({ ...prev, vendorFilter: vendor }));
    if (!isNaN(from) && !isNaN(to) && from > to) {
      const nowMs = Date.now();
      setFilters(prev => ({ ...prev,
        startTime: toUtcText(new Date(nowMs - from * 60_000)),
        endTime:   toUtcText(new Date(nowMs - to   * 60_000)),
      }));
      setActivePreset(`${from}→${to}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setQuickWindow(fromMinAgo: number, toMinAgo: number, preset?: string) {
    const nowMs = Date.now();
    setFilters(prev => ({
      ...prev,
      startTime: toUtcText(new Date(nowMs - fromMinAgo * 60_000)),
      endTime:   toUtcText(new Date(nowMs - toMinAgo   * 60_000)),
    }));
    setActivePreset(preset ?? null);
  }

  function applyRelative() {
    const from = Math.max(0, parseInt(relFrom) || 0);
    const to   = Math.max(0, parseInt(relTo)   || 0);
    if (from <= to) return;
    setQuickWindow(from, to, `${from}→${to}`);
  }

  const setF = (key: keyof FilterState) => (value: string | boolean) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    if (key === "startTime" || key === "endTime") setActivePreset(null);
  };

  const { data: accountsData } = useQuery<{ accounts: any[] }>({
    queryKey: ["/api/sippy/accounts"],
    queryFn: () => fetch("/api/sippy/accounts?limit=500").then(r => r.json()),
    staleTime: 5 * 60_000,
  });
  const accountOptions = (accountsData?.accounts ?? []).map((a: any) => ({
    label: a.username || a.name || `Acct.${a.iAccount}`,
    value: a.username || a.name || `Acct.${a.iAccount}`,
  }));

  const { data: vendorsData } = useQuery<{ vendors: any[] }>({
    queryKey: ["/api/sippy/vendors"],
    queryFn: () => fetch("/api/sippy/vendors?limit=200").then(r => r.json()),
    staleTime: 5 * 60_000,
  });
  const vendorOptions = (vendorsData?.vendors ?? []).map((v: any) => ({
    label: v.name || `Vendor#${v.iVendor}`,
    value: v.name || `Vendor#${v.iVendor}`,
  }));

  const { data, isLoading, isFetching, refetch } = useQuery<ReportData>({
    queryKey: ["/api/reports/asr-acd", submitted],
    queryFn: () => {
      if (!submitted) return Promise.resolve(null as any);
      const startDate = parseUtcText(submitted.startTime);
      const endDate   = parseUtcText(submitted.endTime);
      if (!startDate || !endDate) return Promise.resolve(null as any);
      const p = new URLSearchParams({
        startTime:      startDate.toISOString(),
        endTime:        endDate.toISOString(),
        cli:            submitted.cli,
        cld:            submitted.cld,
        groupOrig:      submitted.groupOrig,
        groupTerm:      submitted.groupTerm,
        accountFilter:  submitted.accountFilter,
        vendorFilter:   submitted.vendorFilter,
        sortOrig:       submitted.sortOrig,
        sortTerm:       submitted.sortTerm,
        hideOrigEmpty:  String(submitted.hideOrigEmpty),
        hideTermEmpty:  String(submitted.hideTermEmpty),
        highlightBelow: submitted.highlightBelow,
      });
      return fetch(`/api/reports/asr-acd?${p}`).then(r => r.json());
    },
    enabled,
    staleTime: Infinity,
  });

  const handleUpdate = useCallback(() => {
    if (!parseUtcText(filters.startTime) || !parseUtcText(filters.endTime)) return;
    const snap = { ...filters };
    setSubmitted(snap);
    if (!enabled) setEnabled(true);
    else refetch();
  }, [filters, enabled, refetch]);

  const threshold     = parseFloat((submitted ?? filters).highlightBelow) || 10;
  const loading       = isLoading || isFetching;
  const parsedStart   = parseUtcText(filters.startTime);
  const parsedEnd     = parseUtcText(filters.endTime);
  const windowMinutes = (parsedStart && parsedEnd)
    ? Math.round((parsedEnd.getTime() - parsedStart.getTime()) / 60_000) : null;

  // KPI summary values
  const origTotal  = data?.origTotal;
  const termTotal  = data?.termTotal;
  const overallAsr = origTotal?.totalCalls
    ? origTotal.asr : (termTotal?.asr ?? 0);
  const overallNer = origTotal?.totalCalls
    ? (origTotal.nerPct ?? null) : (termTotal?.nerPct ?? null);
  const overallAcd  = origTotal?.acdSec ?? 0;
  const overallFas  = origTotal?.fasRate ?? termTotal?.fasRate ?? null;
  const totalCalls  = origTotal?.totalCalls ?? termTotal?.totalCalls ?? 0;

  // Critical-row counts for the alert strip
  const critOrigCount = data?.origination.filter(r => asrQuality(r.asr, r.totalCalls) === "critical" || (r.nerPct != null && nerQuality(r.nerPct, r.totalCalls) === "critical")).length ?? 0;
  const critTermCount = data?.termination.filter(r => asrQuality(r.asr, r.totalCalls) === "critical" || (r.nerPct != null && nerQuality(r.nerPct, r.totalCalls) === "critical")).length ?? 0;

  // CSV export
  function downloadCsv() {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`"ASR/NER/ACD Report — Generated: ${new Date(data.generatedAt).toLocaleString()}"`);
    lines.push(`"CDRs in window: ${data.cdrCount}"`);
    lines.push("");
    lines.push("ORIGINATION");
    lines.push(["Caller/Group","Calls","Billable","Duration","ACD","ASR%","NER%","FAS%","PDD sec","Revenue"].join(","));
    data.origination.forEach(r => {
      lines.push([`"${r.name.replace(/"/g,'""')}"`,r.totalCalls,r.billableCalls,
        fmtDuration(r.durationSec),fmtDuration(r.acdSec),
        r.asr.toFixed(4),(r.nerPct!=null?r.nerPct.toFixed(2):""),(r.fasRate!=null?r.fasRate.toFixed(2):""),
        r.avgPdd.toFixed(3),r.amount.toFixed(6)].join(","));
    });
    lines.push("");
    lines.push("TERMINATION");
    lines.push(["Vendor/Connection","Calls","Billable","Duration","ACD","ASR%","NER%","FAS%","PDD sec","Cost"].join(","));
    data.termination.forEach(r => {
      lines.push([`"${r.name.replace(/"/g,'""')}"`,r.totalCalls,r.billableCalls,
        fmtDuration(r.durationSec),fmtDuration(r.acdSec),
        r.asr.toFixed(4),(r.nerPct!=null?r.nerPct.toFixed(2):""),(r.fasRate!=null?r.fasRate.toFixed(2):""),
        r.avgPdd.toFixed(3),r.amount.toFixed(6)].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `asr-ner-${new Date().toISOString().slice(0,16).replace("T","-")}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const origGroupLabel: Record<string,string> = { none:"None", caller:"Caller", ip:"IP", ip_caller:"IP / Caller" };
  const termGroupLabel: Record<string,string>  = { none:"None", vendor:"Vendor", connection:"Connection" };

  const presets = [
    { label: '15 m', from: 15,   to: 0, key: '15m'  },
    { label: '30 m', from: 30,   to: 0, key: '30m'  },
    { label: '1 h',  from: 60,   to: 0, key: '1h'   },
    { label: '90 m', from: 90,   to: 0, key: '90m'  },
    { label: '4 h',  from: 240,  to: 0, key: '4h'   },
    { label: '24 h', from: 1440, to: 0, key: '24h'  },
  ] as const;

  return (
    <div className="p-6 space-y-5 max-w-full">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
            ASR / NER Report
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Origination &amp; termination quality — ASR, NER, ACD, FAS, PDD metrics from CDR ground truth
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {data.cdrCount.toLocaleString()} CDRs · {new Date(data.generatedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour:'2-digit', minute:'2-digit', second:'2-digit' })} UTC
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!data || loading}
            data-testid="button-download-csv" className="gap-1.5 h-8 text-xs">
            <Download className="h-3.5 w-3.5" />CSV
          </Button>
        </div>
      </div>

      {/* ── Degradation Warning Banner ── */}
      {data?.degraded && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3" data-testid="banner-degraded-mode">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              Analytics running in fallback mode — accuracy degraded
            </p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
              Native Sippy aggregation is unavailable (portal authentication failed). Data shown is a partial CDR cache sample — totals, ASR, ACD, and vendor breakdowns are incomplete and should not be used for routing or operational decisions. Restore portal credentials in Settings to enable full reporting.
            </p>
          </div>
        </div>
      )}

      {/* ── Enrichment overlay info panel ── */}
      {data?.enrichmentMeta && !data?.degraded && (
        <div className={cn(
          "flex items-start gap-3 rounded-lg border px-4 py-3 text-xs",
          data.enrichmentMeta.confidence === 'high'
            ? "border-emerald-500/30 bg-emerald-500/5"
            : data.enrichmentMeta.confidence === 'medium'
            ? "border-blue-500/30 bg-blue-500/5"
            : data.enrichmentMeta.confidence === 'low'
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border bg-muted/20"
        )} data-testid="banner-enrichment">
          <Info className={cn("h-3.5 w-3.5 mt-0.5 shrink-0",
            data.enrichmentMeta.confidence === 'high'    ? "text-emerald-500" :
            data.enrichmentMeta.confidence === 'medium'  ? "text-blue-500"    :
            data.enrichmentMeta.confidence === 'low'     ? "text-amber-500"   : "text-muted-foreground"
          )} />
          <div className="flex-1 min-w-0">
            <span className={cn("font-semibold",
              data.enrichmentMeta.confidence === 'high'   ? "text-emerald-700 dark:text-emerald-400" :
              data.enrichmentMeta.confidence === 'medium' ? "text-blue-700 dark:text-blue-400"       :
              data.enrichmentMeta.confidence === 'low'    ? "text-amber-700 dark:text-amber-400"     : "text-muted-foreground"
            )}>
              {data.enrichmentMeta.confidence === 'suppressed'
                ? "Enrichment unavailable"
                : `Enrichment overlay · ${data.enrichmentMeta.confidence.charAt(0).toUpperCase() + data.enrichmentMeta.confidence.slice(1)} confidence`
              }
            </span>
            {" — "}
            <span className="text-muted-foreground">
              {data.enrichmentMeta.sampleSize.toLocaleString()} CDR sample / {data.enrichmentMeta.nativeTotalCalls.toLocaleString()} native calls
              {" "}({data.enrichmentMeta.coveragePct}% coverage).
              {" "}
              {data.enrichmentMeta.confidence === 'suppressed'
                ? "NER and FAS require ≥5% sample coverage — showing as unavailable."
                : data.enrichmentMeta.confidence === 'low'
                ? "NER and FAS estimates shown in totals — treat as indicative only."
                : "NER and FAS shown in totals row. Per-row enrichment pending per-call vendor resolution."}
            </span>
          </div>
          <span className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            data.enrichmentMeta.confidence === 'high'    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
            data.enrichmentMeta.confidence === 'medium'  ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"         :
            data.enrichmentMeta.confidence === 'low'     ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"       :
            "bg-muted text-muted-foreground"
          )}>
            {data.enrichmentMeta.confidence}
          </span>
        </div>
      )}

      {/* ── KPI tiles — only shown after a report is loaded ── */}
      {data && !loading && totalCalls > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label="Total Calls"
            value={totalCalls.toLocaleString()}
            sub={`${(origTotal?.billableCalls ?? 0).toLocaleString()} billable`}
            level="neutral"
            icon={<Activity className="h-4 w-4" />}
          />
          <KpiCard
            label="ASR"
            value={`${overallAsr.toFixed(1)}%`}
            sub={overallAsr >= BENCH.asr.good ? "Above target" : overallAsr >= BENCH.asr.warning ? "Acceptable" : overallAsr >= BENCH.asr.critical ? "Low" : "Critical — investigate"}
            level={asrQuality(overallAsr, totalCalls)}
            icon={asrQuality(overallAsr, totalCalls) === "good" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          />
          <KpiCard
            label="NER"
            value={overallNer != null ? `${overallNer.toFixed(1)}%` : "—"}
            sub={overallNer != null
              ? (() => {
                  const quality = overallNer >= BENCH.ner.good ? "Above target" : overallNer >= BENCH.ner.warning ? "Acceptable" : "Needs attention";
                  const conf    = data?.enrichmentMeta?.confidence;
                  const badge   = conf && conf !== 'suppressed' ? ` · ${conf} confidence` : '';
                  return `${quality}${badge} (derived)`;
                })()
              : "Derived — unavailable from aggregated source"}
            level={overallNer != null ? nerQuality(overallNer, totalCalls) : "neutral"}
            icon={overallNer != null && overallNer >= BENCH.ner.warning ? <Shield className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          />
          <KpiCard
            label="Avg ACD"
            value={fmtMins(overallAcd)}
            sub={overallAcd >= BENCH.acd.good ? "Healthy session length" : overallAcd >= BENCH.acd.warning ? "Short sessions" : "Very short — check FAS"}
            level={overallAcd >= BENCH.acd.good ? "good" : overallAcd >= BENCH.acd.warning ? "warning" : overallAcd > 0 ? "critical" : "neutral"}
            icon={<Clock className="h-4 w-4" />}
          />
        </div>
      )}

      {/* ── Critical entity alert strip ── */}
      {data && !loading && (critOrigCount > 0 || critTermCount > 0) && (
        <div className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-red-600 dark:text-red-400 font-medium">
            {[
              critOrigCount > 0 && `${critOrigCount} origination ${critOrigCount === 1 ? 'entry' : 'entries'}`,
              critTermCount > 0 && `${critTermCount} termination ${critTermCount === 1 ? 'entry' : 'entries'}`,
            ].filter(Boolean).join(" and ")}{" "}
            below quality threshold — highlighted below.
          </span>
          <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
            <Info className="h-3.5 w-3.5" />ASR &lt;{BENCH.asr.critical}% or NER &lt;{BENCH.ner.critical}%
          </span>
        </div>
      )}

      {/* ── Time window bar ── */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Time window</span>
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5 tracking-wide">UTC</span>

        <div className="flex flex-wrap gap-1.5">
          {presets.map(p => (
            <button key={p.key} data-testid={`button-preset-${p.key}`}
              onClick={() => setQuickWindow(p.from, p.to, p.key)}
              className={cn("px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                activePreset === p.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground")}>
              {p.label}
            </button>
          ))}
          <button data-testid="button-preset-today"
            onClick={() => {
              const n = new Date();
              const midnight = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
              setFilters(prev => ({ ...prev, startTime: toUtcText(midnight), endTime: toUtcText(n) }));
              setActivePreset('today');
            }}
            className={cn("px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
              activePreset === 'today' ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground")}>
            Today
          </button>
          <button data-testid="button-preset-yesterday"
            onClick={() => {
              const n = new Date();
              const yStart = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - 1));
              const yEnd   = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
              setFilters(prev => ({ ...prev, startTime: toUtcText(yStart), endTime: toUtcText(yEnd) }));
              setActivePreset('yesterday');
            }}
            className={cn("px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
              activePreset === 'yesterday' ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground")}>
            Yesterday
          </button>
        </div>

        <div className="hidden sm:block h-5 w-px bg-border" />

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground whitespace-nowrap">From</span>
          <input type="number" min="1" value={relFrom}
            onChange={e => { setRelFrom(e.target.value); setActivePreset(null); }}
            data-testid="input-rel-from"
            className="w-16 h-7 rounded-md border border-input bg-background px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-ring" />
          <span className="text-xs text-muted-foreground whitespace-nowrap">min ago →</span>
          <input type="number" min="0" value={relTo}
            onChange={e => { setRelTo(e.target.value); setActivePreset(null); }}
            data-testid="input-rel-to"
            className="w-16 h-7 rounded-md border border-input bg-background px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-ring" />
          <span className="text-xs text-muted-foreground whitespace-nowrap">min ago</span>
          <button onClick={applyRelative} data-testid="button-apply-relative"
            disabled={parseInt(relFrom) <= parseInt(relTo)}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity">
            Set
          </button>
        </div>

        {parsedStart && parsedEnd && windowMinutes !== null && windowMinutes > 0 && (
          <span className="ml-auto text-xs text-muted-foreground hidden lg:block">
            {toUtcText(parsedStart).slice(11)} → {toUtcText(parsedEnd).slice(11)} · {windowMinutes} min
          </span>
        )}
      </div>

      {/* ── Filter panel ── */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">

          {/* Origination column */}
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CLI / Origination</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <UtcTextInput label="Start Date / Time (UTC)" value={filters.startTime}
                onChange={v => setFilters(prev => ({ ...prev, startTime: v }))} data-testid="input-start-time" />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">CLI contains</Label>
                <Input className="h-8 text-sm" placeholder="e.g. +44" value={filters.cli}
                  onChange={e => setF("cli")(e.target.value)} data-testid="input-cli" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Origination Group By</Label>
              <Select value={filters.groupOrig} onValueChange={setF("groupOrig")}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-group-orig"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="caller">Caller</SelectItem>
                  <SelectItem value="ip">IP</SelectItem>
                  <SelectItem value="ip_caller">IP / Caller</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Caller / Account</Label>
              <Combobox value={filters.accountFilter} onChange={v => setF("accountFilter")(v)}
                options={accountOptions} placeholder="All accounts" emptyLabel="All accounts" data-testid="select-account" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sort By</Label>
              <Select value={filters.sortOrig} onValueChange={setF("sortOrig")}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-sort-orig"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="calls">Number of Calls</SelectItem>
                  <SelectItem value="billable">Billable Calls</SelectItem>
                  <SelectItem value="duration">Billed Duration</SelectItem>
                  <SelectItem value="asr">ASR %</SelectItem>
                  <SelectItem value="caller_number">Caller Number</SelectItem>
                  <SelectItem value="ip">IP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
              <input type="checkbox" checked={filters.hideOrigEmpty}
                onChange={e => setF("hideOrigEmpty")(e.target.checked)}
                className="h-3.5 w-3.5 rounded" data-testid="checkbox-hide-orig-empty" />
              <span className="text-xs text-muted-foreground">Hide entries without calls</span>
            </label>
          </div>

          {/* Termination column */}
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CLD / Termination</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <UtcTextInput label="End Date / Time (UTC)" value={filters.endTime}
                onChange={v => setFilters(prev => ({ ...prev, endTime: v }))} data-testid="input-end-time" />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">CLD contains</Label>
                <Input className="h-8 text-sm" placeholder="e.g. +92" value={filters.cld}
                  onChange={e => setF("cld")(e.target.value)} data-testid="input-cld" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Currency</Label>
              <Select value={filters.currency} onValueChange={setF("currency")}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="usd">US Dollar (USD)</SelectItem>
                  <SelectItem value="eur">Euro (EUR)</SelectItem>
                  <SelectItem value="gbp">British Pound (GBP)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Termination Group By</Label>
              <Select value={filters.groupTerm} onValueChange={setF("groupTerm")}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-group-term"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="connection">Connection</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Vendor</Label>
              <Combobox value={filters.vendorFilter} onChange={v => setF("vendorFilter")(v)}
                options={vendorOptions} placeholder="All vendors" emptyLabel="All vendors" data-testid="select-vendor" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sort By</Label>
              <Select value={filters.sortTerm} onValueChange={setF("sortTerm")}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-sort-term"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="calls">Number of Calls</SelectItem>
                  <SelectItem value="billable">Billable Calls</SelectItem>
                  <SelectItem value="duration">Billed Duration</SelectItem>
                  <SelectItem value="asr">ASR %</SelectItem>
                  <SelectItem value="vendor_connection">Vendor / Connection</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
              <input type="checkbox" checked={filters.hideTermEmpty}
                onChange={e => setF("hideTermEmpty")(e.target.checked)}
                className="h-3.5 w-3.5 rounded" data-testid="checkbox-hide-term-empty" />
              <span className="text-xs text-muted-foreground">Hide entries without calls</span>
            </label>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Highlight ASR below %</Label>
            <Input type="number" min="0" max="100" step="0.5" className="h-7 w-20 text-sm"
              value={filters.highlightBelow} onChange={e => setF("highlightBelow")(e.target.value)}
              data-testid="input-highlight-below" />
          </div>
          {submitted && parseUtcText(submitted.startTime) && parseUtcText(submitted.endTime) && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Queried: <span className="font-mono text-foreground">{submitted.startTime} → {submitted.endTime}</span> UTC
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={handleUpdate}
              disabled={loading || !parseUtcText(filters.startTime) || !parseUtcText(filters.endTime)}
              data-testid="button-update-report" className="gap-2 h-8">
              {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Run Report
            </Button>
          </div>
        </div>
      </div>

      {/* ── Empty state ── */}
      {!enabled && !data && (
        <div className="rounded-lg border border-dashed border-border p-14 text-center space-y-3">
          <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto" />
          <div>
            <p className="text-sm text-muted-foreground">
              Configure your filters and click <strong className="text-foreground">Run Report</strong> to generate ASR / NER analytics.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              All times are UTC · Format: <span className="font-mono">YYYY-MM-DD HH:MM</span>
            </p>
          </div>
          <div className="pt-2"><BenchmarkLegend /></div>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div className="rounded-lg border border-border p-10 text-center space-y-2">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Aggregating CDR data…</p>
        </div>
      )}

      {/* ── Report tables ── */}
      {data && !loading && (
        <div className="space-y-5">
          <BenchmarkLegend />
          <ReportTable
            title="Origination"
            subtitle={`Grouped by ${origGroupLabel[submitted?.groupOrig ?? "caller"] ?? submitted?.groupOrig}`}
            rows={data.origination}
            total={data.origTotal}
            amountLabel={`Revenue, ${(submitted?.currency ?? "usd").toUpperCase()}`}
            nameLabel={submitted?.groupOrig === "ip" ? "IP" : submitted?.groupOrig === "ip_caller" ? "IP / Caller" : submitted?.groupOrig === "none" ? "Group" : "Caller"}
            threshold={threshold}
            icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
          />
          <ReportTable
            title="Termination"
            subtitle={`Grouped by ${termGroupLabel[submitted?.groupTerm ?? "connection"] ?? submitted?.groupTerm}`}
            rows={data.termination}
            total={data.termTotal}
            amountLabel={`Cost, ${(submitted?.currency ?? "usd").toUpperCase()}`}
            nameLabel={submitted?.groupTerm === "vendor" ? "Vendor" : submitted?.groupTerm === "none" ? "Group" : "Vendor / Connection"}
            threshold={threshold}
            icon={<TrendingDown className="h-4 w-4 text-rose-400" />}
          />
        </div>
      )}
    </div>
  );
}
