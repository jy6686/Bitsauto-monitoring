import { useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Download, BarChart3, TrendingUp, TrendingDown, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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
}

interface FilterState {
  startTime: string;
  endTime: string;
  cli: string;
  cld: string;
  groupOrig: string;
  groupTerm: string;
  accountFilter: string;
  vendorFilter: string;
  sortOrig: string;
  sortTerm: string;
  hideOrigEmpty: boolean;
  hideTermEmpty: boolean;
  highlightBelow: string;
  currency: string;
}

// ── Searchable combobox component ─────────────────────────────────────────────

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

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );
  const selected = options.find(o => o.value === value);

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
            <Input
              autoFocus
              className="h-7 text-xs"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
            >
              {!value && <Check className="h-3 w-3" />}
              {value && <span className="w-3" />}
              <span className="text-muted-foreground italic">{emptyLabel}</span>
            </button>
            {filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); setSearch(""); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
              >
                {value === o.value ? <Check className="h-3 w-3 text-primary" /> : <span className="w-3" />}
                <span className="truncate">{o.label}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground text-center">No results</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AsrAcdReportPage() {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

  const [filters, setFilters] = useState<FilterState>({
    startTime:     toDatetimeLocal(oneHourAgo),
    endTime:       toDatetimeLocal(now),
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
  });

  const [submitted, setSubmitted] = useState<FilterState | null>(null);
  const [enabled, setEnabled]     = useState(false);

  const setF = (key: keyof FilterState) => (value: string | boolean) =>
    setFilters(prev => ({ ...prev, [key]: value }));

  // Fetch accounts list for selector
  const { data: accountsData } = useQuery<{ accounts: any[] }>({
    queryKey: ["/api/sippy/accounts"],
    queryFn: () => fetch("/api/sippy/accounts?limit=500").then(r => r.json()),
    staleTime: 5 * 60_000,
  });
  const accountOptions = (accountsData?.accounts ?? []).map((a: any) => ({
    label: a.username || a.name || `Acct.${a.iAccount}`,
    value: a.username || a.name || `Acct.${a.iAccount}`,
  }));

  // Fetch vendors list for selector
  const { data: vendorsData } = useQuery<{ vendors: any[] }>({
    queryKey: ["/api/sippy/vendors"],
    queryFn: () => fetch("/api/sippy/vendors?limit=200").then(r => r.json()),
    staleTime: 5 * 60_000,
  });
  const vendorOptions = (vendorsData?.vendors ?? []).map((v: any) => ({
    label: v.name || `Vendor#${v.iVendor}`,
    value: v.name || `Vendor#${v.iVendor}`,
  }));

  // Report query — manual trigger only
  const { data, isLoading, isFetching, refetch } = useQuery<ReportData>({
    queryKey: ["/api/reports/asr-acd", submitted],
    queryFn: () => {
      if (!submitted) return Promise.resolve(null as any);
      const p = new URLSearchParams({
        startTime:     new Date(submitted.startTime).toISOString(),
        endTime:       new Date(submitted.endTime).toISOString(),
        cli:           submitted.cli,
        cld:           submitted.cld,
        groupOrig:     submitted.groupOrig,
        groupTerm:     submitted.groupTerm,
        accountFilter: submitted.accountFilter,
        vendorFilter:  submitted.vendorFilter,
        sortOrig:      submitted.sortOrig,
        sortTerm:      submitted.sortTerm,
        hideOrigEmpty: String(submitted.hideOrigEmpty),
        hideTermEmpty: String(submitted.hideTermEmpty),
        highlightBelow: submitted.highlightBelow,
      });
      return fetch(`/api/reports/asr-acd?${p}`).then(r => r.json());
    },
    enabled,
    staleTime: Infinity,
  });

  const handleUpdate = useCallback(() => {
    const snap = { ...filters };
    setSubmitted(snap);
    if (!enabled) setEnabled(true);
    else refetch();
  }, [filters, enabled, refetch]);

  const threshold = parseFloat((submitted ?? filters).highlightBelow) || 10;
  const loading   = isLoading || isFetching;

  // CSV export
  function downloadCsv() {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`"ASR/ACD Report — Generated: ${new Date(data.generatedAt).toLocaleString()}"`);
    lines.push(`"CDRs in window: ${data.cdrCount}"`);
    lines.push("");
    lines.push("ORIGINATION");
    lines.push(["Caller / Group", "Number of Calls", "Billable Calls", "Billed Duration (mm:ss)", "ACD (mm:ss)", "ASR %", "Avg PDD sec", "Revenue USD"].join(","));
    data.origination.forEach(r => {
      lines.push([`"${r.name.replace(/"/g,'""')}"`, r.totalCalls, r.billableCalls, fmtDuration(r.durationSec), fmtDuration(r.acdSec), r.asr.toFixed(4), r.avgPdd.toFixed(4), r.amount.toFixed(7)].join(","));
    });
    lines.push(["Total", data.origTotal.totalCalls, data.origTotal.billableCalls, fmtDuration(data.origTotal.durationSec), fmtDuration(data.origTotal.acdSec), data.origTotal.asr.toFixed(4), "", data.origTotal.amount.toFixed(7)].join(","));
    lines.push("");
    lines.push("TERMINATION");
    lines.push(["Vendor / Connection", "Number of Calls", "Billable Calls", "Billed Duration (mm:ss)", "ACD (mm:ss)", "ASR %", "Avg PDD sec", "Cost USD"].join(","));
    data.termination.forEach(r => {
      lines.push([`"${r.name.replace(/"/g,'""')}"`, r.totalCalls, r.billableCalls, fmtDuration(r.durationSec), fmtDuration(r.acdSec), r.asr.toFixed(4), r.avgPdd.toFixed(4), r.amount.toFixed(7)].join(","));
    });
    lines.push(["Total", data.termTotal.totalCalls, data.termTotal.billableCalls, fmtDuration(data.termTotal.durationSec), fmtDuration(data.termTotal.acdSec), data.termTotal.asr.toFixed(4), "", data.termTotal.amount.toFixed(7)].join(","));

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `asr-acd-${new Date().toISOString().slice(0,16).replace("T","-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const origGroupLabel: Record<string,string> = {
    none: "None", caller: "Caller", ip: "IP", ip_caller: "IP / Caller",
  };
  const termGroupLabel: Record<string,string> = {
    none: "None", vendor: "Vendor", connection: "Connection",
  };

  return (
    <div className="p-6 space-y-5 max-w-full">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              ASR / ACD Report
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Origination &amp; termination quality metrics — CDR ground truth layer
            </p>
          </div>
          {data && (
            <Badge variant="outline" className="text-xs text-muted-foreground mt-1 shrink-0">
              {data.cdrCount.toLocaleString()} CDRs · {new Date(data.generatedAt).toLocaleTimeString()}
            </Badge>
          )}
        </div>

        {/* ── Filter panel ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">

            {/* ─ CLI / Origination column ─ */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CLI / Origination</span>
              </div>

              {/* Start date/time */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Start Date / Time</Label>
                  <Input
                    type="datetime-local"
                    className="h-8 text-sm"
                    value={filters.startTime}
                    onChange={e => setF("startTime")(e.target.value)}
                    data-testid="input-start-time"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">CLI contains</Label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. +44"
                    value={filters.cli}
                    onChange={e => setF("cli")(e.target.value)}
                    data-testid="input-cli"
                  />
                </div>
              </div>

              {/* Origination Group By */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Origination Group By</Label>
                <Select value={filters.groupOrig} onValueChange={setF("groupOrig")}>
                  <SelectTrigger className="h-8 text-sm" data-testid="select-group-orig">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="caller">Caller</SelectItem>
                    <SelectItem value="ip">IP</SelectItem>
                    <SelectItem value="ip_caller">IP / Caller</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Caller / Account selector */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Caller / Account</Label>
                <Combobox
                  value={filters.accountFilter}
                  onChange={v => setF("accountFilter")(v)}
                  options={accountOptions}
                  placeholder="All accounts"
                  emptyLabel="All accounts"
                  data-testid="select-account"
                />
              </div>

              {/* Origination Sort By */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Sort By</Label>
                <Select value={filters.sortOrig} onValueChange={setF("sortOrig")}>
                  <SelectTrigger className="h-8 text-sm" data-testid="select-sort-orig">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caller_number">Caller Number</SelectItem>
                    <SelectItem value="ip">IP</SelectItem>
                    <SelectItem value="calls">Number of Calls</SelectItem>
                    <SelectItem value="billable">Billable Calls</SelectItem>
                    <SelectItem value="duration">Billed Duration</SelectItem>
                    <SelectItem value="asr">ASR %</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Origination hide empty */}
              <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
                <input
                  type="checkbox"
                  checked={filters.hideOrigEmpty}
                  onChange={e => setF("hideOrigEmpty")(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-hide-orig-empty"
                />
                <span className="text-xs text-muted-foreground">Hide entries without calls</span>
              </label>
            </div>

            {/* ─ CLD / Termination column ─ */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CLD / Termination</span>
              </div>

              {/* End date/time + CLD filter */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">End Date / Time</Label>
                  <Input
                    type="datetime-local"
                    className="h-8 text-sm"
                    value={filters.endTime}
                    onChange={e => setF("endTime")(e.target.value)}
                    data-testid="input-end-time"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">CLD contains</Label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. +92"
                    value={filters.cld}
                    onChange={e => setF("cld")(e.target.value)}
                    data-testid="input-cld"
                  />
                </div>
              </div>

              {/* Currency */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Currency</Label>
                <Select value={filters.currency} onValueChange={setF("currency")}>
                  <SelectTrigger className="h-8 text-sm" data-testid="select-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usd">US Dollar (USD)</SelectItem>
                    <SelectItem value="eur">Euro (EUR)</SelectItem>
                    <SelectItem value="gbp">British Pound (GBP)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Termination Group By */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Termination Group By</Label>
                <Select value={filters.groupTerm} onValueChange={setF("groupTerm")}>
                  <SelectTrigger className="h-8 text-sm" data-testid="select-group-term">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="vendor">Vendor</SelectItem>
                    <SelectItem value="connection">Connection</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Vendor selector */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Vendor</Label>
                <Combobox
                  value={filters.vendorFilter}
                  onChange={v => setF("vendorFilter")(v)}
                  options={vendorOptions}
                  placeholder="All vendors"
                  emptyLabel="All vendors"
                  data-testid="select-vendor"
                />
              </div>

              {/* Termination Sort By */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Sort By</Label>
                <Select value={filters.sortTerm} onValueChange={setF("sortTerm")}>
                  <SelectTrigger className="h-8 text-sm" data-testid="select-sort-term">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vendor_connection">Vendor / Connection</SelectItem>
                    <SelectItem value="calls">Number of Calls</SelectItem>
                    <SelectItem value="billable">Billable Calls</SelectItem>
                    <SelectItem value="duration">Billed Duration</SelectItem>
                    <SelectItem value="asr">ASR %</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Termination hide empty */}
              <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
                <input
                  type="checkbox"
                  checked={filters.hideTermEmpty}
                  onChange={e => setF("hideTermEmpty")(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-hide-term-empty"
                />
                <span className="text-xs text-muted-foreground">Hide entries without calls</span>
              </label>
            </div>
          </div>

          {/* ─ Common action bar ─ */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Highlight ASR below %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                className="h-7 w-20 text-sm"
                value={filters.highlightBelow}
                onChange={e => setF("highlightBelow")(e.target.value)}
                data-testid="input-highlight-below"
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button
                onClick={handleUpdate}
                disabled={loading}
                data-testid="button-update-report"
                className="gap-2 h-8"
              >
                {loading
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : <BarChart3 className="h-3.5 w-3.5" />}
                Update Report
              </Button>
              <Button
                variant="outline"
                onClick={downloadCsv}
                disabled={!data || loading}
                data-testid="button-download-csv"
                className="gap-2 h-8"
              >
                <Download className="h-3.5 w-3.5" />
                Download CSV / Excel
              </Button>
            </div>
          </div>
        </div>

        {/* Empty state */}
        {!enabled && !data && (
          <div className="rounded-lg border border-dashed border-border p-14 text-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Set your filters and click{" "}
              <strong className="text-foreground">Update Report</strong> to generate the ASR/ACD report.
            </p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="rounded-lg border border-border p-10 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Aggregating CDR data…</p>
          </div>
        )}

        {/* Report tables */}
        {data && !loading && (
          <div className="space-y-5">
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

// ── Report table component ────────────────────────────────────────────────────

interface ReportTableProps {
  title: string;
  subtitle: string;
  rows: ReportRow[];
  total: ReportRow;
  amountLabel: string;
  nameLabel: string;
  threshold: number;
  icon: React.ReactNode;
}

function ReportTable({ title, subtitle, rows, total, amountLabel, nameLabel, threshold, icon }: ReportTableProps) {
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
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">Number of Calls</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">Billable Calls</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">Billed Duration, mm:ss</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">ACD, mm:ss</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">ASR, %</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">Avg PDD, sec</th>
              <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">{amountLabel}</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No data for the selected period and filters.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const lowAsr = row.totalCalls > 0 && row.asr < threshold;
                return (
                  <tr
                    key={i}
                    data-testid={`row-${title.toLowerCase()}-${i}`}
                    className={cn(
                      "border-b border-border/50 transition-colors",
                      lowAsr
                        ? "bg-red-500/10 hover:bg-red-500/15 dark:bg-red-900/20 dark:hover:bg-red-900/30"
                        : "hover:bg-muted/30"
                    )}
                  >
                    <td className="px-4 py-2 font-medium text-foreground max-w-[280px] truncate" title={row.name}>
                      {row.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.totalCalls.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.billableCalls.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(row.durationSec)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(row.acdSec)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", lowAsr ? "text-red-500 dark:text-red-400" : "")}>
                      {row.asr.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {row.avgPdd.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.amount.toFixed(7)}</td>
                  </tr>
                );
              })
            )}
          </tbody>

          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-muted/40 border-t-2 border-border font-semibold text-sm">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{total.totalCalls.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{total.billableCalls.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtDuration(total.durationSec)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtDuration(total.acdSec)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{total.asr.toFixed(4)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{total.amount.toFixed(7)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
