import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow, subDays, startOfDay } from "date-fns";
import {
  ClipboardList, Search, RefreshCw, ChevronDown, ChevronRight,
  Shield, User, Settings, AlertTriangle, DollarSign, Zap,
  Info, AlertCircle, XCircle, Download, Filter, Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditEvent } from "@shared/schema";

const CATEGORY_META: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  user:      { label: "User",      icon: User,          color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20"    },
  system:    { label: "System",    icon: Settings,      color: "text-slate-400",  bg: "bg-slate-500/10 border-slate-500/20"  },
  sippy:     { label: "Sippy",     icon: Zap,           color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20"},
  fraud:     { label: "Fraud",     icon: Shield,        color: "text-red-400",    bg: "bg-red-500/10 border-red-500/20"      },
  financial: { label: "Financial", icon: DollarSign,    color: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/20"},
};

const SEVERITY_META: Record<string, { icon: any; color: string; dot: string }> = {
  info:     { icon: Info,          color: "text-sky-400",    dot: "bg-sky-400"    },
  warning:  { icon: AlertCircle,   color: "text-amber-400",  dot: "bg-amber-400"  },
  critical: { icon: XCircle,       color: "text-red-400",    dot: "bg-red-400"    },
};

function CategoryBadge({ cat }: { cat: string }) {
  const m = CATEGORY_META[cat] ?? { label: cat, icon: Activity, color: "text-slate-400", bg: "bg-slate-500/10 border-slate-500/20" };
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.bg} ${m.color}`}>
      <Icon className="w-3 h-3" />
      {m.label}
    </span>
  );
}

function SeverityDot({ sev }: { sev: string }) {
  const m = SEVERITY_META[sev] ?? SEVERITY_META.info;
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${m.dot}`} title={sev} />;
}

function MetaRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="text-muted-foreground w-28 flex-shrink-0 font-mono">{label}</span>
      <span className="text-foreground/80 break-all">{String(value)}</span>
    </div>
  );
}

function EventRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const meta = event.metadata as Record<string, unknown> | null;
  const hasMeta = meta && Object.keys(meta).length > 0;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/30 transition-colors"
        data-testid={`audit-row-${event.id}`}
        onClick={() => hasMeta && setOpen(o => !o)}
      >
        <TableCell className="w-6 pl-3">
          {hasMeta
            ? open
              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            : <span className="w-3.5 h-3.5 block" />}
        </TableCell>
        <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground font-mono w-40">
          <span title={event.timestamp ? new Date(event.timestamp).toISOString() : ''}>
            {event.timestamp
              ? format(new Date(event.timestamp), "MMM d, HH:mm:ss")
              : "—"}
          </span>
        </TableCell>
        <TableCell className="w-8">
          <SeverityDot sev={event.severity ?? "info"} />
        </TableCell>
        <TableCell className="w-32">
          <CategoryBadge cat={event.category} />
        </TableCell>
        <TableCell className="font-mono text-[12px] font-semibold text-foreground">
          {event.action}
        </TableCell>
        <TableCell className="text-[12px] text-muted-foreground max-w-[160px] truncate" title={event.actor}>
          {event.actor}
        </TableCell>
        <TableCell className="text-[12px] text-muted-foreground max-w-[180px]">
          {event.targetName
            ? <span className="truncate block" title={`${event.targetType ?? ""} ${event.targetId ?? ""}`}>{event.targetName}</span>
            : event.targetId
              ? <span className="font-mono truncate block">{event.targetType ? `${event.targetType}:` : ""}{event.targetId}</span>
              : <span className="opacity-40">—</span>}
        </TableCell>
      </TableRow>
      {open && hasMeta && (
        <TableRow className="bg-muted/10 hover:bg-muted/10">
          <TableCell colSpan={7} className="pb-3 pt-1 pl-12">
            <div className="flex flex-col gap-0.5 p-3 bg-background/50 rounded-md border border-border/40">
              {Object.entries(meta!).map(([k, v]) => (
                <MetaRow key={k} label={k} value={v} />
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

interface AuditResponse {
  events: AuditEvent[];
  total: number;
}

interface StatsRow {
  category: string;
  count: number;
}

const PAGE_SIZE = 100;

export default function AuditLogPage() {
  const [category, setCategory] = useState("all");
  const [severity, setSeverity]  = useState("all");
  const [search, setSearch]       = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [offset, setOffset]       = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const params = new URLSearchParams();
  if (category !== "all") params.set("category", category);
  if (severity  !== "all") params.set("severity",  severity);
  if (search)               params.set("search",   search);
  params.set("limit",  String(PAGE_SIZE));
  params.set("offset", String(offset));

  const { data, isLoading, isFetching, refetch } = useQuery<AuditResponse>({
    queryKey: ["/api/audit-log", category, severity, search, offset],
    queryFn: () => fetch(`/api/audit-log?${params}`).then(r => r.json()),
    refetchInterval: autoRefresh ? 30_000 : false,
    staleTime: 10_000,
  });

  const { data: statsData } = useQuery<{ stats: StatsRow[] }>({
    queryKey: ["/api/audit-log/stats"],
    refetchInterval: autoRefresh ? 30_000 : false,
    staleTime: 10_000,
  });

  const handleSearch = useCallback(() => {
    setSearch(draftSearch);
    setOffset(0);
  }, [draftSearch]);

  const resetFilters = () => {
    setCategory("all");
    setSeverity("all");
    setSearch("");
    setDraftSearch("");
    setOffset(0);
  };

  const events = data?.events ?? [];
  const total  = data?.total  ?? 0;
  const stats  = statsData?.stats ?? [];
  const totalToday = stats.reduce((s, r) => s + r.count, 0);

  const CATS = ['user','system','sippy','fraud','financial'] as const;

  function exportCSV() {
    if (!events.length) return;
    const header = ["id","timestamp","severity","category","action","actor","targetType","targetId","targetName"];
    const rows = events.map(e => [
      e.id, e.timestamp, e.severity, e.category, e.action, e.actor,
      e.targetType ?? "", e.targetId ?? "", e.targetName ?? "",
    ]);
    const csv = [header, ...rows].map(r => r.map(String).map(v => `"${v.replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `audit-log-${format(new Date(), "yyyyMMdd-HHmmss")}.csv`;
    a.click();
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
            <ClipboardList className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Audit Log</h1>
            <p className="text-sm text-muted-foreground">
              Append-only system event history — every action, in order, forever
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="toggle-autorefresh"
            onClick={() => setAutoRefresh(a => !a)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${autoRefresh ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"}`}
          >
            <RefreshCw className={`w-3 h-3 ${autoRefresh && isFetching ? "animate-spin" : ""}`} />
            {autoRefresh ? "Auto-refresh on" : "Auto-refresh"}
          </button>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-refresh">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} data-testid="btn-export-csv">
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <Card className="bg-card/60 border-border/40">
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Today (all)</p>
            <p className="text-2xl font-bold text-foreground mt-0.5" data-testid="stat-total-today">{totalToday.toLocaleString()}</p>
          </CardContent>
        </Card>
        {CATS.map(cat => {
          const m = CATEGORY_META[cat];
          const count = stats.find(s => s.category === cat)?.count ?? 0;
          const Icon = m.icon;
          return (
            <Card
              key={cat}
              className={`cursor-pointer border-border/40 transition-colors ${category === cat ? "ring-1 ring-inset ring-indigo-500/50" : "hover:bg-muted/20"}`}
              onClick={() => { setCategory(category === cat ? "all" : cat); setOffset(0); }}
              data-testid={`stat-cat-${cat}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-3 h-3 ${m.color}`} />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{m.label}</p>
                </div>
                <p className={`text-2xl font-bold mt-0.5 ${m.color}`}>{count.toLocaleString()}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-9 h-8 text-sm"
            placeholder="Search action, actor, target…"
            value={draftSearch}
            data-testid="input-audit-search"
            onChange={e => setDraftSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
          />
        </div>
        <Button variant="secondary" size="sm" className="h-8" onClick={handleSearch} data-testid="btn-search">
          <Search className="w-3.5 h-3.5" />
        </Button>
        <Select value={category} onValueChange={v => { setCategory(v); setOffset(0); }}>
          <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATS.map(c => <SelectItem key={c} value={c}>{CATEGORY_META[c].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={v => { setSeverity(v); setOffset(0); }}>
          <SelectTrigger className="h-8 w-32 text-sm" data-testid="select-severity">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        {(category !== "all" || severity !== "all" || search) && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={resetFilters} data-testid="btn-reset-filters">
            <Filter className="w-3.5 h-3.5 mr-1" /> Reset
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {total.toLocaleString()} event{total !== 1 ? "s" : ""} matched
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20">
              <TableHead className="w-6" />
              <TableHead className="text-[11px] uppercase tracking-wide w-40">Timestamp</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide w-8" />
              <TableHead className="text-[11px] uppercase tracking-wide w-32">Category</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide">Action</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide">Actor</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide">Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><div className="h-4 bg-muted/40 rounded animate-pulse w-3/4" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ClipboardList className="w-8 h-8 opacity-20" />
                    <p className="text-sm">No audit events found</p>
                    {(category !== "all" || severity !== "all" || search) && (
                      <p className="text-xs opacity-70">Try adjusting your filters</p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              events.map(e => <EventRow key={e.id} event={e} />)
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}</span>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              disabled={offset === 0}
              data-testid="btn-prev-page"
              onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={offset + PAGE_SIZE >= total}
              data-testid="btn-next-page"
              onClick={() => setOffset(o => o + PAGE_SIZE)}
            >
              Next {Math.min(PAGE_SIZE, total - offset - PAGE_SIZE)} →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
