import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, DollarSign, Hash, TrendingUp, AlertTriangle, CheckCircle, FileSpreadsheet } from "lucide-react";
import { exportToExcel } from "@/lib/export-excel";

interface UnbilledGroup {
  iTariff:        string;
  snapshotCount:  number;
  totalReproduced: number;
  totalMinutes:   number;
  oldestDate:     string;
  newestDate:     string;
  unlinkedCount:  number;
  linkedCount:    number;
}

interface UnbilledSummary {
  groups:       UnbilledGroup[];
  totalAmount:  number;
  totalMinutes: number;
  totalSnapshots: number;
  periodFrom:   string;
  periodTo:     string;
}

function toISO(d: Date) { return d.toISOString().slice(0, 10); }

function defaultRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toISO(start), to: toISO(now) };
}

export default function UnbilledUsagePage() {
  const { from: defFrom, to: defTo } = defaultRange();
  const [from, setFrom] = useState(defFrom);
  const [to,   setTo]   = useState(defTo);
  const [tariff, setTariff] = useState("all");

  const { data, isLoading, isError } = useQuery<UnbilledSummary>({
    queryKey: ["/api/billing/unbilled-usage", from, to, tariff],
    queryFn: () => {
      const p = new URLSearchParams({ from, to });
      if (tariff !== "all") p.set("iTariff", tariff);
      return apiRequest("GET", `/api/billing/unbilled-usage?${p}`).then(r => r.json());
    },
    staleTime: 30_000,
  });

  const groups = data?.groups ?? [];
  const allTariffs = [...new Set(groups.map(g => g.iTariff))].sort();

  const displayed = tariff === "all" ? groups : groups.filter(g => g.iTariff === tariff);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="h-6 w-6 text-primary" />
          Unbilled Usage
        </h1>
        <p className="text-muted-foreground mt-1">
          Locked CDR snapshots not yet included in an approved invoice — your WIP receivables.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <AlertTriangle className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-400">Finance View — Read Only</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            This view shows rated &amp; locked snapshots that are accumulating but not yet invoiced.
            Use the Invoice Generator to convert these into a draft invoice.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label className="text-xs mb-1.5 block">From</Label>
              <Input
                data-testid="input-unbilled-from"
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="w-38"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">To</Label>
              <Input
                data-testid="input-unbilled-to"
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="w-38"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Tariff</Label>
              <Select value={tariff} onValueChange={setTariff}>
                <SelectTrigger data-testid="select-unbilled-tariff" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tariffs</SelectItem>
                  {allTariffs.map(t => (
                    <SelectItem key={t} value={t}>Tariff {t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Unbilled Amount",   value: `$${(data?.totalAmount ?? 0).toFixed(2)}`,       icon: <DollarSign className="h-4 w-4 text-amber-400" /> },
          { label: "Total Snapshots",   value: (data?.totalSnapshots ?? 0).toLocaleString(),    icon: <Hash className="h-4 w-4 text-blue-400" /> },
          { label: "Total Minutes",     value: ((data?.totalMinutes ?? 0) / 60).toFixed(0) + "h", icon: <Clock className="h-4 w-4 text-slate-400" /> },
          { label: "Tariff Groups",     value: groups.length,                                   icon: <TrendingUp className="h-4 w-4 text-emerald-400" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                {s.icon}
              </div>
              <p className="text-2xl font-bold mt-1 font-mono">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Unbilled Snapshots by Tariff</CardTitle>
          <CardDescription className="text-xs">
            Period: {from} → {to} · {displayed.length} tariff group(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : isError ? (
            <div className="text-center py-8 text-red-400">Failed to load unbilled usage data.</div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 text-emerald-400 opacity-60" />
              <p>No unbilled snapshots in this period — all usage has been invoiced.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tariff ID</TableHead>
                    <TableHead>Snapshots</TableHead>
                    <TableHead>Minutes</TableHead>
                    <TableHead>Amount (USD)</TableHead>
                    <TableHead>Earliest CDR</TableHead>
                    <TableHead>Latest CDR</TableHead>
                    <TableHead>In Invoice</TableHead>
                    <TableHead>Unlinked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayed.map(g => (
                    <TableRow key={g.iTariff} data-testid={`row-unbilled-${g.iTariff}`}>
                      <TableCell className="font-mono font-semibold">{g.iTariff}</TableCell>
                      <TableCell>{g.snapshotCount.toLocaleString()}</TableCell>
                      <TableCell className="font-mono">{(g.totalMinutes / 60).toFixed(1)}h</TableCell>
                      <TableCell className="font-mono font-semibold text-amber-400">
                        ${g.totalReproduced.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{g.oldestDate ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{g.newestDate ?? "—"}</TableCell>
                      <TableCell>
                        {g.linkedCount > 0
                          ? <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">{g.linkedCount}</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
                          {g.unlinkedCount}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
