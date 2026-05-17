import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Download, Filter, BarChart3, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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
  period: string;
  highlightBelow: number;
  generatedAt: string;
  cdrCount: number;
  origination: ReportRow[];
  termination: ReportRow[];
  origTotal: ReportRow;
  termTotal: ReportRow;
}

interface FilterState {
  period: string;
  cli: string;
  cld: string;
  highlightBelow: string;
  hideEmpty: boolean;
  sortOrig: string;
  sortTerm: string;
}

export default function AsrAcdReportPage() {
  const [filters, setFilters] = useState<FilterState>({
    period: "1h",
    cli: "",
    cld: "",
    highlightBelow: "10",
    hideEmpty: true,
    sortOrig: "calls",
    sortTerm: "calls",
  });
  const [submitted, setSubmitted] = useState<FilterState>(filters);
  const [enabled, setEnabled] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery<ReportData>({
    queryKey: ["/api/reports/asr-acd", submitted],
    queryFn: () => {
      const p = new URLSearchParams({
        period: submitted.period,
        cli: submitted.cli,
        cld: submitted.cld,
        highlightBelow: submitted.highlightBelow,
        hideEmpty: String(submitted.hideEmpty),
        sortOrig: submitted.sortOrig,
        sortTerm: submitted.sortTerm,
      });
      return fetch(`/api/reports/asr-acd?${p}`).then((r) => r.json());
    },
    enabled,
    staleTime: Infinity,
  });

  const handleUpdate = useCallback(() => {
    const snap = { ...filters };
    setSubmitted(snap);
    if (!enabled) {
      setEnabled(true);
    } else {
      refetch();
    }
  }, [filters, enabled, refetch]);

  const threshold = parseFloat(submitted.highlightBelow) || 10;
  const loading = isLoading || isFetching;

  const setF = (key: keyof FilterState) => (value: string | boolean) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  function downloadCsv() {
    if (!data) return;
    const lines: string[] = [];

    lines.push(`"ASR/ACD Report — Period: ${data.period} — Generated: ${new Date(data.generatedAt).toLocaleString()}"`);
    lines.push(`"Total CDRs in window: ${data.cdrCount}"`);
    lines.push("");
    lines.push("ORIGINATION");
    lines.push(
      ["Caller", "Number of Calls", "Billable Calls", "Billed Duration (mm:ss)", "ACD (mm:ss)", "ASR %", "Avg PDD sec", "Revenue USD"].join(",")
    );
    data.origination.forEach((r) => {
      lines.push(
        [
          `"${r.name.replace(/"/g, '""')}"`,
          r.totalCalls,
          r.billableCalls,
          fmtDuration(r.durationSec),
          fmtDuration(r.acdSec),
          r.asr.toFixed(4),
          r.avgPdd.toFixed(4),
          r.amount.toFixed(7),
        ].join(",")
      );
    });
    lines.push(
      [
        "Total",
        data.origTotal.totalCalls,
        data.origTotal.billableCalls,
        fmtDuration(data.origTotal.durationSec),
        fmtDuration(data.origTotal.acdSec),
        data.origTotal.asr.toFixed(4),
        "",
        data.origTotal.amount.toFixed(7),
      ].join(",")
    );

    lines.push("");
    lines.push("TERMINATION");
    lines.push(
      ["Vendor / Connection", "Number of Calls", "Billable Calls", "Billed Duration (mm:ss)", "ACD (mm:ss)", "ASR %", "Avg PDD sec", "Cost USD"].join(",")
    );
    data.termination.forEach((r) => {
      lines.push(
        [
          `"${r.name.replace(/"/g, '""')}"`,
          r.totalCalls,
          r.billableCalls,
          fmtDuration(r.durationSec),
          fmtDuration(r.acdSec),
          r.asr.toFixed(4),
          r.avgPdd.toFixed(4),
          r.amount.toFixed(7),
        ].join(",")
      );
    });
    lines.push(
      [
        "Total",
        data.termTotal.totalCalls,
        data.termTotal.billableCalls,
        fmtDuration(data.termTotal.durationSec),
        fmtDuration(data.termTotal.acdSec),
        data.termTotal.asr.toFixed(4),
        "",
        data.termTotal.amount.toFixed(7),
      ].join(",")
    );

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `asr-acd-report-${submitted.period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <LayoutShell>
      <div className="p-6 space-y-6 max-w-full">
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

        {/* Filter panel */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Time Period</Label>
              <Select value={filters.period} onValueChange={setF("period")}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30m">Last 30 minutes</SelectItem>
                  <SelectItem value="1h">Last 1 hour</SelectItem>
                  <SelectItem value="4h">Last 4 hours</SelectItem>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">CLI contains</Label>
              <Input
                className="h-8 text-sm"
                placeholder="e.g. +44"
                value={filters.cli}
                onChange={(e) => setF("cli")(e.target.value)}
                data-testid="input-cli"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">CLD contains</Label>
              <Input
                className="h-8 text-sm"
                placeholder="e.g. +92"
                value={filters.cld}
                onChange={(e) => setF("cld")(e.target.value)}
                data-testid="input-cld"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Highlight ASR below %</Label>
              <Input
                className="h-8 text-sm"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={filters.highlightBelow}
                onChange={(e) => setF("highlightBelow")(e.target.value)}
                data-testid="input-highlight-below"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Sort Origination by</Label>
              <Select value={filters.sortOrig} onValueChange={setF("sortOrig")}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-sort-orig">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="calls">Number of Calls</SelectItem>
                  <SelectItem value="asr">ASR %</SelectItem>
                  <SelectItem value="acd">ACD</SelectItem>
                  <SelectItem value="revenue">Revenue</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Sort Termination by</Label>
              <Select value={filters.sortTerm} onValueChange={setF("sortTerm")}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-sort-term">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="calls">Number of Calls</SelectItem>
                  <SelectItem value="asr">ASR %</SelectItem>
                  <SelectItem value="acd">ACD</SelectItem>
                  <SelectItem value="cost">Cost</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <Button
              onClick={handleUpdate}
              disabled={loading}
              data-testid="button-update-report"
              className="gap-2"
            >
              {loading
                ? <RefreshCw className="h-4 w-4 animate-spin" />
                : <BarChart3 className="h-4 w-4" />}
              Update Report
            </Button>

            <Button
              variant="outline"
              onClick={downloadCsv}
              disabled={!data || loading}
              data-testid="button-download-csv"
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Download CSV / Excel
            </Button>

            <label className="flex items-center gap-2 ml-auto cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.hideEmpty}
                onChange={(e) => setF("hideEmpty")(e.target.checked)}
                className="h-3.5 w-3.5 rounded"
                data-testid="checkbox-hide-empty"
              />
              <span className="text-xs text-muted-foreground">Hide entries without calls</span>
            </label>
          </div>
        </div>

        {/* Empty prompt */}
        {!enabled && !data && (
          <div className="rounded-lg border border-dashed border-border p-14 text-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Set your filters above and click{" "}
              <strong className="text-foreground">Update Report</strong> to generate the
              ASR/ACD report.
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

        {/* Tables */}
        {data && !loading && (
          <div className="space-y-6">
            <ReportTable
              title="Origination"
              subtitle="Grouped by caller / account"
              rows={data.origination}
              total={data.origTotal}
              amountLabel="Revenue, USD"
              nameLabel="Caller"
              threshold={threshold}
              icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
            />
            <ReportTable
              title="Termination"
              subtitle="Grouped by vendor / connection"
              rows={data.termination}
              total={data.termTotal}
              amountLabel="Cost, USD"
              nameLabel="Vendor / Connection"
              threshold={threshold}
              icon={<TrendingDown className="h-4 w-4 text-rose-400" />}
            />
          </div>
        )}
      </div>
    </LayoutShell>
  );
}

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
      <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
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
              <th className="text-left px-4 py-2.5 font-semibold min-w-[200px]">{nameLabel}</th>
              <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">Number of Calls</th>
              <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">Billable Calls</th>
              <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">Billed Duration, mm:ss</th>
              <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">ACD, mm:ss</th>
              <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">ASR, %</th>
              <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">Avg PDD, sec</th>
              <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">{amountLabel}</th>
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
                    <td
                      className="px-4 py-2 font-medium text-foreground max-w-[300px] truncate"
                      title={row.name}
                      data-testid={`cell-name-${i}`}
                    >
                      {row.name}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.totalCalls.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.billableCalls.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtDuration(row.durationSec)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtDuration(row.acdSec)}</td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right tabular-nums font-semibold",
                        lowAsr ? "text-red-500 dark:text-red-400" : ""
                      )}
                      data-testid={`cell-asr-${i}`}
                    >
                      {row.asr.toFixed(4)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {row.avgPdd.toFixed(4)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.amount.toFixed(7)}</td>
                  </tr>
                );
              })
            )}
          </tbody>

          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-muted/40 border-t-2 border-border font-semibold text-sm">
                <td className="px-4 py-2.5 text-foreground">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{total.totalCalls.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{total.billableCalls.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtDuration(total.durationSec)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtDuration(total.acdSec)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{total.asr.toFixed(4)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{total.amount.toFixed(7)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
