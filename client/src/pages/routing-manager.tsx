import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Route, RefreshCw, Database, Server, Network, CheckCircle2,
  AlertCircle, Clock, Layers, Wifi, ChevronRight, Search, Filter,
  Loader2, GitBranch, BarChart3, Eye, Settings2, Construction,
  ArrowRight, Activity, Timer, AlertTriangle, Zap,
  List, Grid3X3, ShieldAlert, XCircle, Shield,
  Plus, Pencil, Trash2, ExternalLink, DollarSign, CreditCard, X,
} from "lucide-react";
import { ToastAction } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function approvalToastOpts(data: any, navigate: (to: string) => void) {
  if (!data?.requiresApproval) return null;
  return {
    title: "Submitted for approval",
    description: `Request #${data.requestId} queued for review.`,
    action: <ToastAction altText="View request" onClick={() => navigate(`/approvals?id=${data.requestId}`)}>View →</ToastAction>,
  };
}

// ── Types ──────────────────────────────────────────────────────────────────────

type CacheMeta = {
  last_sync_at:     string | null;
  last_sync_status: "ok" | "error" | "syncing" | "pending";
  last_sync_error:  string | null;
  rg_count:         number;
  ds_count:         number;
  conn_count:       number;
};

type RoutingGroup = {
  i_routing_group: number;
  name:            string;
  policy:          string | null;
  media_relay:     string | null;
  on_net:          boolean;
  members_count:   number;
  cached_at:       string;
};

type DestinationSet = {
  i_destination_set: number;
  name:              string;
  currency:          string | null;
  description:       string | null;
  connect_fee:       number | null;
  free_seconds:      number | null;
  grace_period:      number | null;
  route_count:       number;
  cld_translation:   string | null;
  cli_translation:   string | null;
  cached_at:         string;
};

type Connection = {
  i_connection: number;
  name:         string;
  i_vendor:     number | null;
  vendor_name:  string | null;
  host:         string | null;
  protocol:     string | null;
  blocked:      boolean;
  cached_at:    string;
};

type RgMember = {
  iRoutingGroupMember: number | null;
  iConnection:         number | null;
  iConnectionGroup:    number | null;
  iDestinationSet:     number | null;
  preference:          number | null;
  weight:              number | null;
  activationDate:      string | null;
  expirationDate:      string | null;
  connectionName:      string | null;
  vendorName:          string | null;
  blocked:             boolean;
  host:                string | null;
  destSetName:         string | null;
  destSetRouteCount:   number | null;
};
type RgDetail = { members: RgMember[]; ok: boolean; message: string };

type DsRoute = {
  prefix:          string;
  preference:      number | null;
  huntstop:        number | null;
  timeout:         number | null;
  price1:          number | null;
  priceN:          number | null;
  forbidden:       boolean | null;
  activationDate:  string | null;
  expirationDate:  string | null;
};
type DsRoutesData = { success: boolean; list: DsRoute[]; message: string };

type QbrVendor = {
  vendor:         string;
  connectionName?: string;
  host?:          string;
  protocol?:      string;
  blocked:        boolean;
  totalCalls:     number;
  answeredCalls:  number;
  asr:            number;
  acd:            number;
  pdd:            number;
  qbrScore:       number;
  status:         'excellent' | 'good' | 'degraded' | 'critical';
  totalMinutes:   number;
  totalCost:      number;
};
type QbrSummary = {
  totalCalls:     number;
  answeredCalls:  number;
  asr:            number;
  acd:            number;
  pdd:            number;
  activeRoutes:   number;
  degradedRoutes: number;
};
type QbrMeta = { hours: number; cdrsAnalyzed: number; updatedAt: string | null };
type QbrData  = { vendors: QbrVendor[]; summary: QbrSummary; meta: QbrMeta };

type DSRef = {
  iDS:        number;
  dsName:     string;
  routeCount: number;
  rgName:     string;
  iRg:        number;
  preference: number | null;
};
type ConnRef = {
  iConnection: number;
  connName:    string;
  vendorName:  string;
  preference:  number | null;
  rgName:      string;
};
type CovConn = {
  iConnection: number;
  name:        string;
  vendorName:  string | null;
  host:        string | null;
  protocol:    string | null;
  blocked:     boolean;
  coveredDSets: DSRef[];
};
type CovDS = {
  iDS:                  number;
  name:                 string;
  routeCount:           number;
  cldTranslation:       string | null;
  connectedConnections: ConnRef[];
};
type CovGaps = {
  unusedConnections:  CovConn[];
  orphanDSets:        CovDS[];
  singleCoveredDSets: CovDS[];
};
type CoverageMatrix = {
  connections:     CovConn[];
  destinationSets: CovDS[];
  gaps:            CovGaps;
  rgCount:         number;
  failedRGs:       number;
  buildTimeMs:     number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function policyLabel(policy: string | null): string {
  if (!policy) return "—";
  const map: Record<string, string> = {
    "least_cost":          "Least Cost",
    "prefix,preference":   "Prefix + Preference",
    "prefix":              "Prefix Length",
    "preference":          "Route Preference",
    "order":               "Entries Order",
    "order,weight":        "Order + Weight",
    "weighted":            "Weighted",
  };
  return map[policy] ?? policy;
}

function policyColor(policy: string | null): string {
  if (!policy) return "text-muted-foreground";
  if (policy.includes("least_cost")) return "text-emerald-400";
  if (policy.includes("prefix"))     return "text-cyan-400";
  if (policy.includes("weighted"))   return "text-violet-400";
  if (policy.includes("preference")) return "text-amber-400";
  return "text-blue-400";
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── RgMembersPanel ─────────────────────────────────────────────────────────────

function RgMembersPanel({ groupId }: { groupId: number }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [deleteTarget, setDeleteTarget] = useState<{ memberId: number; label: string } | null>(null);

  // "Add entry" inline row state — matches Sippy UI (vendor → connection → dest set → dates → order → weight)
  const [rowVendorId, setRowVendorId] = useState<number | null>(null);
  const [rowConn,     setRowConn]     = useState("");
  const [rowDs,       setRowDs]       = useState("");
  const [rowPref,     setRowPref]     = useState("1");
  const [rowWeight,   setRowWeight]   = useState("1");
  const [rowAct,      setRowAct]      = useState("now");
  const [rowExp,      setRowExp]      = useState("never");

  const { data, isLoading, refetch } = useQuery<RgDetail>({
    queryKey: ["/api/routing-cache/routing-groups", groupId, "detail"],
  });

  // Live vendor list from Sippy (all vendors, not just cached)
  const { data: sippyVendorsData, isLoading: vendorsLoading } = useQuery<{ vendors: { iVendor: number; name: string }[] }>({
    queryKey: ["/api/sippy/vendors"],
    staleTime: 60_000,
    select: (d: any) => ({
      vendors: (d.vendors ?? []).map((v: any) => ({ iVendor: v.iVendor ?? v.i_vendor, name: v.name }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))
    }),
  });

  // Live connections for selected vendor from Sippy
  const { data: vendorConnsData, isLoading: vendorConnsLoading } = useQuery<{ connections: { iConnection: number; name: string }[] }>({
    queryKey: ["/api/sippy/vendors", rowVendorId, "connections"],
    enabled: rowVendorId !== null,
    staleTime: 30_000,
    select: (d: any) => ({
      connections: (d.connections ?? []).map((c: any) => ({ iConnection: c.iConnection, name: c.name }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))
    }),
  });

  // Destination sets from cache
  const { data: setsData } = useQuery<{ sets: DestinationSet[] }>({
    queryKey: ["/api/routing-cache/destination-sets"],
  });
  const cachedSets = setsData?.sets ?? [];

  const addMut = useMutation({
    mutationFn: async (body: object) => (await apiRequest("POST", `/api/sippy/routing-groups/${groupId}/members`, body)).json(),
    onSuccess: (data: any) => {
      const a = approvalToastOpts(data, navigate);
      if (a) toast(a); else toast({ title: "Routing entry added" });
      setRowVendorId(null); setRowConn(""); setRowDs(""); setRowPref("1"); setRowWeight("1"); setRowAct("now"); setRowExp("never");
      refetch();
    },
    onError: (e: any) => toast({ title: "Error adding routing entry", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (memberId: number) => (await apiRequest("DELETE", `/api/sippy/routing-groups/${groupId}/members/${memberId}`)).json(),
    onSuccess: (data: any) => {
      const a = approvalToastOpts(data, navigate);
      if (a) toast(a); else toast({ title: "Routing entry removed" });
      setDeleteTarget(null);
      refetch();
    },
    onError: (e: any) => toast({ title: "Error removing entry", description: e.message, variant: "destructive" }),
  });

  const handleAdd = () => {
    if (!rowConn || !rowDs || !rowPref) return;
    addMut.mutate({
      iConnection:     parseInt(rowConn),
      iDestinationSet: parseInt(rowDs),
      preference:      parseInt(rowPref) || 1,
      weight:          parseInt(rowWeight) || 1,
      activationDate:  rowAct === "now"   ? undefined : rowAct,
      expirationDate:  rowExp === "never" ? undefined : rowExp,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 px-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading routing entries from Sippy…
      </div>
    );
  }

  const members = data?.members ?? [];

  const thCls = "text-left px-2 py-1.5 font-semibold text-muted-foreground text-[11px] whitespace-nowrap";
  const cellCls = "px-2 py-1.5 text-xs";
  const selCls  = "w-full text-xs bg-background border border-border/60 rounded px-1.5 py-1 focus:outline-none focus:border-primary";

  return (
    <>
      {/* Sippy-style Routing Entries table with inline add row */}
      <div className="mx-4 mb-3">
        {!data?.ok && (
          <div className="py-2 text-xs text-rose-400/80 italic">
            Failed to load entries: {data?.message ?? "Sippy unavailable"}
          </div>
        )}

        <div className="overflow-x-auto rounded-md border border-border/40 bg-background/40">
          <table className="w-full min-w-[860px] text-xs">
            <thead>
              <tr className="bg-muted/40 border-b border-border/30">
                <th className={thCls}>Vendor</th>
                <th className={thCls}>Connection</th>
                <th className={thCls}>Destination Set</th>
                <th className={thCls}>Activation Date</th>
                <th className={thCls}>Expiration Date</th>
                <th className={cn(thCls, "text-center")}>Order #</th>
                <th className={cn(thCls, "text-center")}>Weight</th>
                <th className={cn(thCls, "w-8")} />
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && data?.ok && (
                <tr>
                  <td colSpan={8} className="px-3 py-3 text-xs text-muted-foreground/50 italic text-center">
                    No routing entries yet — use the row below to add one.
                  </td>
                </tr>
              )}
              {members.map((m, i) => (
                <tr key={i} className={cn("border-t border-border/20 hover:bg-muted/20 transition-colors", m.blocked && "opacity-40")}>
                  <td className={cellCls}>
                    {m.vendorName
                      ? <span className="font-medium text-amber-400/90">{m.vendorName}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className={cellCls}>
                    <div className="font-medium">{m.connectionName ?? `#${m.iConnection}`}</div>
                    {m.host && <div className="text-[10px] text-muted-foreground/60 font-mono">{m.host}</div>}
                  </td>
                  <td className={cellCls}>
                    {m.destSetName
                      ? <span className="text-violet-400 font-medium">{m.destSetName}</span>
                      : <span className="text-muted-foreground/40">{m.iDestinationSet ? `DS #${m.iDestinationSet}` : "—"}</span>}
                    {m.destSetRouteCount != null && (
                      <span className="ml-1 text-[10px] text-muted-foreground/50">({m.destSetRouteCount} routes)</span>
                    )}
                  </td>
                  <td className={cn(cellCls, "text-muted-foreground/70 font-mono text-[10px]")}>
                    {m.activationDate ?? "now"}
                  </td>
                  <td className={cn(cellCls, "text-muted-foreground/70 font-mono text-[10px]")}>
                    {m.expirationDate ?? "never"}
                  </td>
                  <td className={cn(cellCls, "text-center font-mono font-bold text-cyan-400")}>{m.preference ?? "—"}</td>
                  <td className={cn(cellCls, "text-center font-mono text-muted-foreground")}>{m.weight ?? "—"}</td>
                  <td className={cn(cellCls, "text-center")}>
                    {m.iRoutingGroupMember != null && (
                      <button
                        data-testid={`btn-delete-member-${m.iRoutingGroupMember}`}
                        onClick={() => setDeleteTarget({ memberId: m.iRoutingGroupMember!, label: m.connectionName ?? `#${m.iRoutingGroupMember}` })}
                        className="text-rose-400/60 hover:text-rose-400 transition-colors"
                        title="Remove entry"
                      ><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </td>
                </tr>
              ))}

              {/* ── Inline Add Row (matches Sippy UI) ── */}
              <tr className="border-t border-border/40 bg-muted/10">
                {/* Vendor — live from Sippy */}
                <td className="px-1.5 py-1.5">
                  <select
                    value={rowVendorId !== null ? String(rowVendorId) : ""}
                    onChange={e => { const v = e.target.value; setRowVendorId(v ? parseInt(v) : null); setRowConn(""); }}
                    className={selCls} data-testid="select-entry-vendor"
                    disabled={vendorsLoading}
                  >
                    <option value="">{vendorsLoading ? "Loading vendors…" : "Select Vendor…"}</option>
                    {(sippyVendorsData?.vendors ?? []).map(v => (
                      <option key={v.iVendor} value={String(v.iVendor)}>{v.name}</option>
                    ))}
                  </select>
                </td>
                {/* Connection — live from Sippy, filtered by vendor */}
                <td className="px-1.5 py-1.5">
                  <select value={rowConn} onChange={e => setRowConn(e.target.value)}
                    className={selCls} data-testid="select-entry-conn"
                    disabled={rowVendorId === null || vendorConnsLoading}
                  >
                    <option value="">
                      {rowVendorId === null ? "Select vendor first" : vendorConnsLoading ? "Loading…" : "Select Connection…"}
                    </option>
                    {(vendorConnsData?.connections ?? []).map(c => (
                      <option key={c.iConnection} value={String(c.iConnection)}>{c.name}</option>
                    ))}
                  </select>
                </td>
                {/* Destination Set */}
                <td className="px-1.5 py-1.5">
                  <datalist id="ds-opts-rg">
                    {cachedSets.map(s => (
                      <option key={s.i_destination_set} value={String(s.i_destination_set)}>{s.name}</option>
                    ))}
                  </datalist>
                  <input list="ds-opts-rg" value={rowDs} onChange={e => setRowDs(e.target.value)}
                    className={selCls} placeholder="DS ID (e.g. 42)" data-testid="input-entry-ds" />
                </td>
                {/* Activation Date */}
                <td className="px-1.5 py-1.5">
                  <input value={rowAct} onChange={e => setRowAct(e.target.value)}
                    placeholder="now" className={cn(selCls, "w-28")}
                    data-testid="input-entry-activation" />
                </td>
                {/* Expiration Date */}
                <td className="px-1.5 py-1.5">
                  <input value={rowExp} onChange={e => setRowExp(e.target.value)}
                    placeholder="never" className={cn(selCls, "w-28")}
                    data-testid="input-entry-expiration" />
                </td>
                {/* Order # (preference) */}
                <td className="px-1.5 py-1.5">
                  <input type="number" min="1" value={rowPref} onChange={e => setRowPref(e.target.value)}
                    className={cn(selCls, "w-14 text-center")} data-testid="input-entry-pref" />
                </td>
                {/* Weight */}
                <td className="px-1.5 py-1.5">
                  <input type="number" min="1" value={rowWeight} onChange={e => setRowWeight(e.target.value)}
                    className={cn(selCls, "w-14 text-center")} data-testid="input-entry-weight" />
                </td>
                {/* Add button */}
                <td className="px-1.5 py-1.5 text-center">
                  <button
                    onClick={handleAdd}
                    disabled={!rowConn || !rowDs || addMut.isPending}
                    className="text-primary/60 hover:text-primary transition-colors disabled:opacity-30"
                    data-testid="btn-add-rg-member"
                    title="Add routing entry"
                  >
                    {addMut.isPending
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Routing Entry?</DialogTitle>
            <DialogDescription>Remove <strong>{deleteTarget?.label}</strong> from this routing group?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.memberId)}
              disabled={deleteMut.isPending} data-testid="btn-confirm-delete-member">
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── DsRoutesPanel ──────────────────────────────────────────────────────────────

function DsRoutesPanel({ dsId, onRunLcr }: { dsId: number; onRunLcr: (prefix: string) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [routePref, setRoutePref] = useState("");
  const [routeHuntstop, setRouteHuntstop] = useState(false);
  const [routeTimeout, setRouteTimeout] = useState("");
  const [routePrice1, setRoutePrice1] = useState("");
  const [routePriceN, setRoutePriceN] = useState("");
  const [routeInterval1, setRouteInterval1] = useState("");
  const [routeIntervalN, setRouteIntervalN] = useState("");
  const [routeForbidden, setRouteForbidden] = useState(false);

  const { data, isLoading, refetch } = useQuery<DsRoutesData>({
    queryKey: ["/api/sippy/destination-sets", dsId, "routes"],
  });

  const addMut = useMutation({
    mutationFn: async (body: object) => (await apiRequest("POST", `/api/sippy/destination-sets/${dsId}/routes`, body)).json(),
    onSuccess: (data: any) => {
      const a = approvalToastOpts(data, navigate);
      if (a) toast(a); else toast({ title: "Route added" });
      setAddOpen(false); setPrefix(""); setRoutePref(""); setRouteHuntstop(false); setRouteTimeout(""); setRoutePrice1(""); setRoutePriceN(""); setRouteInterval1(""); setRouteIntervalN(""); setRouteForbidden(false);
      refetch();
    },
    onError: (e: any) => toast({ title: "Error adding route", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (p: string) => (await apiRequest("DELETE", `/api/sippy/destination-sets/${dsId}/routes/${encodeURIComponent(p)}`)).json(),
    onSuccess: (data: any) => {
      const a = approvalToastOpts(data, navigate);
      if (a) toast(a); else toast({ title: "Route deleted" });
      setDeleteTarget(null);
      refetch();
    },
    onError: (e: any) => toast({ title: "Error deleting route", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 px-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading routes from Sippy…
      </div>
    );
  }

  const routes = data?.list ?? [];

  return (
    <>
      {/* Add Route button */}
      <div className="px-4 pb-2 flex justify-end">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setAddOpen(true)}
          data-testid="btn-add-ds-route">
          <Plus className="h-3.5 w-3.5" /> Add Route
        </Button>
      </div>

      {!data?.success || routes.length === 0 ? (
        <div className="py-3 px-4 text-xs text-muted-foreground/60 italic">
          {!data?.success
            ? `Failed to load: ${data?.message ?? "Sippy unavailable"}`
            : "No routes yet — click Add Route to create one."}
        </div>
      ) : (
        <div className="overflow-x-auto border border-border/40 rounded-lg mx-4 mb-3 bg-background/40">
          <table className="w-full text-xs min-w-[620px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Prefix</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Pref</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Huntstop</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Timeout</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r, i) => (
                <tr key={i} className={cn("border-t border-border/20 hover:bg-muted/20 transition-colors", r.forbidden && "opacity-40")}>
                  <td className="px-3 py-2 font-mono font-bold text-cyan-400">+{r.prefix}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{r.preference ?? "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {r.huntstop
                      ? <span className="text-amber-400 font-bold" title="Huntstop enabled">●</span>
                      : <span className="text-muted-foreground/20">○</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground/70">{r.timeout ? `${r.timeout}s` : "—"}</td>
                  <td className="px-3 py-2">
                    {r.forbidden
                      ? <Badge variant="destructive" className="h-4 text-[9px] px-1.5">Blocked</Badge>
                      : <span className="text-[10px] text-emerald-400 font-medium">Active</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {!r.forbidden && (
                        <button
                          data-testid={`btn-lcr-${r.prefix}`}
                          onClick={() => onRunLcr(r.prefix)}
                          className="text-[10px] font-semibold text-primary hover:text-primary/70 transition-colors flex items-center gap-0.5"
                        >
                          Run LCR <ArrowRight className="h-2.5 w-2.5" />
                        </button>
                      )}
                      <button
                        data-testid={`btn-rate-cards-${r.prefix}`}
                        onClick={() => navigate(`/rate-cards?prefix=${encodeURIComponent(r.prefix)}`)}
                        className="text-[10px] font-semibold text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-0.5"
                        title="View in Rate Cards"
                      >
                        <CreditCard className="h-2.5 w-2.5" /> Rates
                      </button>
                      <button
                        data-testid={`btn-delete-route-${r.prefix}`}
                        onClick={() => setDeleteTarget(r.prefix)}
                        className="text-rose-400/60 hover:text-rose-400 transition-colors ml-1"
                        title="Delete route"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Route Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Route</DialogTitle>
            <DialogDescription>Add a new prefix/route to this destination set.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Prefix (digits only, no +) *</Label>
                <Input value={prefix} onChange={e => setPrefix(e.target.value.replace(/\D/g, ""))}
                  placeholder="e.g. 44 or 9230" data-testid="input-route-prefix" />
              </div>
              <div className="space-y-1.5">
                <Label>Preference</Label>
                <Input type="number" value={routePref} onChange={e => setRoutePref(e.target.value)}
                  placeholder="optional" data-testid="input-route-pref" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Timeout (sec)</Label>
                <Input type="number" value={routeTimeout} onChange={e => setRouteTimeout(e.target.value)}
                  placeholder="optional" data-testid="input-route-timeout" />
              </div>
              <div className="space-y-1.5 flex flex-col justify-end">
                <div className="flex items-center gap-2 py-1">
                  <input type="checkbox" id="chk-huntstop" checked={routeHuntstop}
                    onChange={e => setRouteHuntstop(e.target.checked)}
                    className="h-4 w-4 accent-primary" data-testid="chk-route-huntstop" />
                  <label htmlFor="chk-huntstop" className="text-sm font-medium cursor-pointer">Huntstop</label>
                  <span className="text-xs text-muted-foreground">(stop on match)</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Price 1 ($/min)</Label>
                <Input type="number" step="0.0001" value={routePrice1} onChange={e => setRoutePrice1(e.target.value)}
                  placeholder="e.g. 0.012" data-testid="input-route-price1" />
              </div>
              <div className="space-y-1.5">
                <Label>Price N ($/min)</Label>
                <Input type="number" step="0.0001" value={routePriceN} onChange={e => setRoutePriceN(e.target.value)}
                  placeholder="e.g. 0.010" data-testid="input-route-priceN" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Interval 1 (sec)</Label>
                <Input type="number" value={routeInterval1} onChange={e => setRouteInterval1(e.target.value)}
                  placeholder="e.g. 60" data-testid="input-route-interval1" />
              </div>
              <div className="space-y-1.5">
                <Label>Interval N (sec)</Label>
                <Input type="number" value={routeIntervalN} onChange={e => setRouteIntervalN(e.target.value)}
                  placeholder="e.g. 6" data-testid="input-route-intervalN" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input type="checkbox" id="chk-forbidden" checked={routeForbidden}
                onChange={e => setRouteForbidden(e.target.checked)}
                className="h-4 w-4 accent-destructive" data-testid="chk-route-forbidden" />
              <label htmlFor="chk-forbidden" className="text-sm cursor-pointer">
                <span className="font-medium text-rose-400">Forbidden</span>
                <span className="text-muted-foreground ml-1">— block all calls on this prefix</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addMut.mutate({
                prefix,
                ...(routePref ? { preference: parseInt(routePref) } : {}),
                ...(routeHuntstop ? { huntstop: 1 } : {}),
                ...(routeTimeout ? { timeout: parseInt(routeTimeout) } : {}),
                ...(routePrice1 ? { price1: parseFloat(routePrice1) } : {}),
                ...(routePriceN ? { priceN: parseFloat(routePriceN) } : {}),
                ...(routeInterval1 ? { interval1: parseInt(routeInterval1) } : {}),
                ...(routeIntervalN ? { intervalN: parseInt(routeIntervalN) } : {}),
                ...(routeForbidden ? { forbidden: true } : {}),
              })}
              disabled={!prefix || addMut.isPending} data-testid="btn-confirm-add-route">
              {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Route"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Route Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Route?</DialogTitle>
            <DialogDescription>Delete prefix <strong>+{deleteTarget}</strong> from this destination set?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget)}
              disabled={deleteMut.isPending} data-testid="btn-confirm-delete-route">
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Status Banner ──────────────────────────────────────────────────────────────

function CacheStatusBanner({ meta, onSync, syncing }: {
  meta: CacheMeta | undefined;
  onSync: () => void;
  syncing: boolean;
}) {
  const status = meta?.last_sync_status ?? "pending";
  const colors = {
    ok:      "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
    error:   "border-rose-500/30 bg-rose-500/5 text-rose-300",
    syncing: "border-blue-500/30 bg-blue-500/5 text-blue-300",
    pending: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  };
  const icons = {
    ok:      <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
    error:   <AlertCircle className="h-4 w-4 text-rose-400" />,
    syncing: <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />,
    pending: <Clock className="h-4 w-4 text-amber-400" />,
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${colors[status]}`}>
      {icons[status]}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium capitalize">{status === "ok" ? "Cache up to date" : status}</span>
        <span className="text-xs opacity-60 ml-2">
          Last synced {relTime(meta?.last_sync_at ?? null)} ·
          {meta ? ` ${meta.rg_count} routing groups · ${meta.ds_count} destination sets · ${meta.conn_count} connections` : " loading…"}
        </span>
        {meta?.last_sync_error && (
          <p className="text-xs text-rose-400 mt-0.5 truncate">{meta.last_sync_error}</p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onSync}
        disabled={syncing || status === "syncing"}
        data-testid="btn-sync-cache"
        className="shrink-0 gap-1.5 h-7 text-xs"
      >
        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {syncing ? "Syncing…" : "Sync Now"}
      </Button>
    </div>
  );
}

// ── Routing Groups Tab ─────────────────────────────────────────────────────────

const RG_POLICY_OPTIONS = [
  { value: "prefix,preference", label: "Prefix + Preference (recommended)" },
  { value: "least_cost",        label: "Least Cost (LCR)" },
  { value: "order",             label: "Entries Order" },
  { value: "order,weight",      label: "Order + Weight" },
  { value: "weighted",          label: "Weighted Distribution" },
  { value: "preference",        label: "Route Preference" },
];

const MEDIA_RELAY_OPTIONS = [
  { value: "built-in",   label: "Built-in RTPproxy" },
  { value: "direct",     label: "Direct" },
  { value: "force",      label: "Force (via RTPproxy)" },
  { value: "disabled",   label: "Disabled" },
];

const ON_NET_SCOPE_OPTIONS = [
  { value: "all_accounts",    label: "All Accounts" },
  { value: "same_customer",   label: "Same Customer" },
  { value: "same_ip",         label: "Same IP" },
];

const REMOTE_MGMT_TYPES = [
  { value: "disabled",  label: "Disabled" },
  { value: "iex",       label: "IEX" },
  { value: "megaco",    label: "Megaco/H.248" },
];

const DS_CURRENCIES_FULL = [
  { value: "USD", label: "US Dollar (USD)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "GBP", label: "Pound Sterling (GBP)" },
  { value: "AED", label: "UAE Dirham (AED)" },
  { value: "SAR", label: "Saudi Riyal (SAR)" },
  { value: "PKR", label: "Pakistani Rupee (PKR)" },
  { value: "INR", label: "Indian Rupee (INR)" },
  { value: "BDT", label: "Bangladeshi Taka (BDT)" },
  { value: "EGP", label: "Egyptian Pound (EGP)" },
  { value: "TRY", label: "Turkish Lira (TRY)" },
];

type PendingEntry = {
  id:            string;
  iConnection:   number;
  connName:      string;
  vendorName:    string;
  iDestinationSet: number;
  dsName:        string;
  activationDate: string;
  expirationDate: string;
  preference:    number;
  weight:        number;
};

type RgFormProps = {
  rgName: string; setRgName: (v: string) => void;
  rgDescription: string; setRgDescription: (v: string) => void;
  rgMediaRelay: string; setRgMediaRelay: (v: string) => void;
  rgTimeout2xx: string; setRgTimeout2xx: (v: string) => void;
  rgLrnEnabled: boolean; setRgLrnEnabled: (v: boolean) => void;
  rgLrnRule: string; setRgLrnRule: (v: string) => void;
  rgPolicy: string; setRgPolicy: (v: string) => void;
  rgOnNetConnection: string; setRgOnNetConnection: (v: string) => void;
  rgVoicemailConn: string; setRgVoicemailConn: (v: string) => void;
  rgOnNetScope: string; setRgOnNetScope: (v: string) => void;
  rgReplyTimeout: string; setRgReplyTimeout: (v: string) => void;
  rgTimeout1xx: string; setRgTimeout1xx: (v: string) => void;
  rgOnNetTimeout2xx: string; setRgOnNetTimeout2xx: (v: string) => void;
  idSuffix: string;
  pendingEntries?: PendingEntry[];
  setPendingEntries?: (v: PendingEntry[]) => void;
  cachedConns?: Connection[];
  cachedSets?: DestinationSet[];
};

function RgForm({
  rgName, setRgName, rgDescription, setRgDescription,
  rgMediaRelay, setRgMediaRelay, rgTimeout2xx, setRgTimeout2xx,
  rgLrnEnabled, setRgLrnEnabled, rgLrnRule, setRgLrnRule,
  rgPolicy, setRgPolicy,
  rgOnNetConnection, setRgOnNetConnection, rgVoicemailConn, setRgVoicemailConn,
  rgOnNetScope, setRgOnNetScope, rgReplyTimeout, setRgReplyTimeout,
  rgTimeout1xx, setRgTimeout1xx, rgOnNetTimeout2xx, setRgOnNetTimeout2xx,
  idSuffix,
  pendingEntries, setPendingEntries,
  cachedConns = [], cachedSets = [],
}: RgFormProps) {
  // Routing Entries add-row state (always declared, only used when pendingEntries is provided)
  const [rowVendor, setRowVendor] = useState("");
  const [rowConn,   setRowConn]   = useState("");
  const [rowDs,     setRowDs]     = useState("");
  const [rowPref,   setRowPref]   = useState("1");
  const [rowWeight, setRowWeight] = useState("1");

  const SectionHeader = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2 py-1 mb-2 border-b border-border/40">
      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
    </div>
  );

  return (
    <div className="space-y-5 py-2">
      {/* Basic Parameters */}
      <div>
        <SectionHeader label="Basic Parameters" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Group Name *</Label>
            <Input value={rgName} onChange={e => setRgName(e.target.value)}
              placeholder="e.g. Europe-LCR" data-testid={`input-rg-name-${idSuffix}`} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={rgDescription} onChange={e => setRgDescription(e.target.value)}
              placeholder="e.g. Primary Europe routes" data-testid={`input-rg-desc-${idSuffix}`} />
          </div>
        </div>
      </div>

      {/* Advanced Parameters */}
      <div>
        <SectionHeader label="Advanced Parameters" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Media Relay</Label>
            <Select value={rgMediaRelay} onValueChange={setRgMediaRelay}>
              <SelectTrigger data-testid={`select-rg-media-relay-${idSuffix}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEDIA_RELAY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Final 2xx Timeout, sec</Label>
            <Input type="number" value={rgTimeout2xx} onChange={e => setRgTimeout2xx(e.target.value)}
              placeholder="300" data-testid={`input-rg-timeout2xx-${idSuffix}`} />
          </div>
          <div className="space-y-1.5 flex items-center gap-2 col-span-1">
            <input type="checkbox" id={`chk-lrn-${idSuffix}`} checked={rgLrnEnabled}
              onChange={e => setRgLrnEnabled(e.target.checked)}
              className="h-4 w-4 accent-primary mt-5" data-testid={`chk-rg-lrn-${idSuffix}`} />
            <label htmlFor={`chk-lrn-${idSuffix}`} className="text-sm font-medium cursor-pointer mt-5">Enable LRN</label>
          </div>
          <div className="space-y-1.5">
            <Label>LRN Translation Rule</Label>
            <Input value={rgLrnRule} onChange={e => setRgLrnRule(e.target.value)}
              disabled={!rgLrnEnabled}
              placeholder={rgLrnEnabled ? "e.g. s/^/1/" : "Enable LRN first"}
              className="disabled:opacity-40"
              data-testid={`input-rg-lrn-rule-${idSuffix}`} />
          </div>
        </div>
      </div>

      {/* Routing Policy */}
      <div>
        <SectionHeader label="Routing Policy" />
        <div className="space-y-1.5">
          <Label>Policy *</Label>
          <Select value={rgPolicy} onValueChange={setRgPolicy}>
            <SelectTrigger data-testid={`select-rg-policy-${idSuffix}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {RG_POLICY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Select the routing policy that controls how Sippy selects a carrier connection for each call.
          </p>
        </div>
      </div>

      {/* Routing Entries — only shown when pendingEntries state is provided (Create dialog) */}
      {pendingEntries !== undefined && setPendingEntries !== undefined && (() => {
        const reVendors = Array.from(
          new Map(cachedConns.filter(c => c.vendor_name).map(c => [c.vendor_name!, c.vendor_name!])).entries()
        ).map(([v]) => v).sort();
        const reFilteredConns = rowVendor ? cachedConns.filter(c => c.vendor_name === rowVendor) : cachedConns;
        const reAddRow = () => {
          if (!rowConn || !rowDs) return;
          const conn = cachedConns.find(c => String(c.i_connection) === rowConn);
          const ds   = cachedSets.find(s => String(s.i_destination_set) === rowDs);
          if (!conn || !ds) return;
          setPendingEntries([...pendingEntries, {
            id: `${Date.now()}-${Math.random()}`,
            iConnection: conn.i_connection, connName: conn.name, vendorName: conn.vendor_name ?? "",
            iDestinationSet: ds.i_destination_set, dsName: ds.name,
            activationDate: "now", expirationDate: "never",
            preference: parseInt(rowPref) || 1, weight: parseInt(rowWeight) || 1,
          }]);
          setRowConn(""); setRowDs(""); setRowPref("1"); setRowWeight("1");
        };
        return (
          <div>
            <SectionHeader label="Routing Entries" />
            <div className="rounded-md border border-border/40 overflow-hidden text-xs">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/30">
                    <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground">Vendor</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground">Connection</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground">Destination Set</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground">Activation</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground">Expiration</th>
                    <th className="text-center px-2 py-1.5 font-semibold text-muted-foreground">Order#</th>
                    <th className="text-center px-2 py-1.5 font-semibold text-muted-foreground">Weight</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {pendingEntries.map(e => (
                    <tr key={e.id} className="border-b border-border/20 hover:bg-muted/10">
                      <td className="px-2 py-1.5 text-muted-foreground">{e.vendorName || "—"}</td>
                      <td className="px-2 py-1.5">{e.connName}</td>
                      <td className="px-2 py-1.5">{e.dsName}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{e.activationDate}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{e.expirationDate}</td>
                      <td className="px-2 py-1.5 text-center">{e.preference}</td>
                      <td className="px-2 py-1.5 text-center">{e.weight}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => setPendingEntries(pendingEntries.filter(x => x.id !== e.id))}
                          className="text-rose-400/60 hover:text-rose-400 transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/5">
                    <td className="px-1.5 py-1.5">
                      <select value={rowVendor} onChange={ev => { setRowVendor(ev.target.value); setRowConn(""); }}
                        className="w-full text-xs bg-background border border-border/60 rounded px-1.5 py-1 focus:outline-none focus:border-primary">
                        <option value="">Select Vendor...</option>
                        {reVendors.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </td>
                    <td className="px-1.5 py-1.5">
                      <select value={rowConn} onChange={ev => setRowConn(ev.target.value)}
                        className="w-full text-xs bg-background border border-border/60 rounded px-1.5 py-1 focus:outline-none focus:border-primary">
                        <option value="">Select Connection...</option>
                        {reFilteredConns.map(c => (
                          <option key={c.i_connection} value={String(c.i_connection)}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1.5 py-1.5">
                      <datalist id="ds-opts-re">
                        {cachedSets.map(s => (
                          <option key={s.i_destination_set} value={String(s.i_destination_set)}>{s.name}</option>
                        ))}
                      </datalist>
                      <input list="ds-opts-re" value={rowDs} onChange={ev => setRowDs(ev.target.value)}
                        className="w-full text-xs bg-background border border-border/60 rounded px-1.5 py-1 focus:outline-none focus:border-primary"
                        placeholder="DS ID (e.g. 42)" data-testid="input-entry-ds-re" />
                    </td>
                    <td className="px-1.5 py-1.5 text-muted-foreground/60 text-center text-[10px]">now</td>
                    <td className="px-1.5 py-1.5 text-muted-foreground/60 text-center text-[10px]">never</td>
                    <td className="px-1.5 py-1.5">
                      <input type="number" min="1" value={rowPref} onChange={ev => setRowPref(ev.target.value)}
                        className="w-12 text-xs bg-background border border-border/60 rounded px-1.5 py-1 text-center focus:outline-none focus:border-primary" />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <input type="number" min="1" value={rowWeight} onChange={ev => setRowWeight(ev.target.value)}
                        className="w-12 text-xs bg-background border border-border/60 rounded px-1.5 py-1 text-center focus:outline-none focus:border-primary" />
                    </td>
                    <td className="px-1.5 py-1.5 text-center">
                      <button onClick={reAddRow} disabled={!rowConn || !rowDs}
                        className="text-primary/60 hover:text-primary transition-colors disabled:opacity-30">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* On-Net Routing */}
      <div>
        <SectionHeader label="On-Net Routing" />
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Use Connection</Label>
            <Select value={rgOnNetConnection || "_disabled"} onValueChange={v => setRgOnNetConnection(v === "_disabled" ? "" : v)}>
              <SelectTrigger data-testid={`select-rg-onnet-conn-${idSuffix}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_disabled">[ Disabled ]</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Voicemail Connection</Label>
            <Select value={rgVoicemailConn || "_disabled"} onValueChange={v => setRgVoicemailConn(v === "_disabled" ? "" : v)}>
              <SelectTrigger data-testid={`select-rg-vm-conn-${idSuffix}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_disabled">[ Disabled ]</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>On-Net Scope</Label>
            <Select value={rgOnNetScope} onValueChange={setRgOnNetScope}>
              <SelectTrigger data-testid={`select-rg-onnet-scope-${idSuffix}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {ON_NET_SCOPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reply Timeout, sec</Label>
            <Input type="number" value={rgReplyTimeout} onChange={e => setRgReplyTimeout(e.target.value)}
              placeholder="5" data-testid={`input-rg-reply-timeout-${idSuffix}`} />
          </div>
          <div className="space-y-1.5">
            <Label>1xx Timeout, sec</Label>
            <Input type="number" value={rgTimeout1xx} onChange={e => setRgTimeout1xx(e.target.value)}
              placeholder="10" data-testid={`input-rg-timeout1xx-${idSuffix}`} />
          </div>
          <div className="space-y-1.5">
            <Label>2xx Timeout, sec</Label>
            <Input type="number" value={rgOnNetTimeout2xx} onChange={e => setRgOnNetTimeout2xx(e.target.value)}
              placeholder="60" data-testid={`input-rg-onnet-timeout2xx-${idSuffix}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RoutingGroupsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RoutingGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoutingGroup | null>(null);
  // Basic
  const [rgName, setRgName] = useState("");
  const [rgDescription, setRgDescription] = useState("");
  // Advanced
  const [rgMediaRelay, setRgMediaRelay] = useState("built-in");
  const [rgTimeout2xx, setRgTimeout2xx] = useState("300");
  const [rgLrnEnabled, setRgLrnEnabled] = useState(false);
  const [rgLrnRule, setRgLrnRule] = useState("");
  // Routing Policy
  const [rgPolicy, setRgPolicy] = useState("prefix,preference");
  // On-Net Routing
  const [rgOnNetConnection, setRgOnNetConnection] = useState("");
  const [rgVoicemailConn, setRgVoicemailConn] = useState("");
  const [rgOnNetScope, setRgOnNetScope] = useState("all_accounts");
  const [rgReplyTimeout, setRgReplyTimeout] = useState("5");
  const [rgTimeout1xx, setRgTimeout1xx] = useState("10");
  const [rgOnNetTimeout2xx, setRgOnNetTimeout2xx] = useState("60");
  // Routing entries for new group creation
  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);

  const { data, isLoading } = useQuery<{ groups: RoutingGroup[] }>({
    queryKey: ["/api/routing-cache/routing-groups"],
  });
  const { data: connsData } = useQuery<{ connections: Connection[] }>({
    queryKey: ["/api/routing-cache/connections"],
  });
  const { data: setsData } = useQuery<{ sets: DestinationSet[] }>({
    queryKey: ["/api/routing-cache/destination-sets"],
  });
  const rgCachedConns = (connsData?.connections ?? []).filter(c => !c.blocked);
  const rgCachedSets  = setsData?.sets ?? [];
  const groups = (data?.groups ?? []).filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  const invalidate = async () => {
    try { await apiRequest("POST", "/api/routing-cache/sync"); } catch { /* swallow — stale cache shown */ }
    qc.invalidateQueries({ queryKey: ["/api/routing-cache/routing-groups"] });
    qc.invalidateQueries({ queryKey: ["/api/routing-cache/status"] });
  };

  const createMut = useMutation({
    mutationFn: async (body: object) => (await apiRequest("POST", "/api/sippy/routing-groups", body)).json(),
    onSuccess: async (data: any) => {
      if (data?.success && data.iRoutingGroup && pendingEntries.length > 0) {
        let added = 0;
        for (const e of pendingEntries) {
          try {
            const r = await apiRequest("POST", `/api/sippy/routing-groups/${data.iRoutingGroup}/members`, {
              iDestinationSet: e.iDestinationSet,
              iConnection:     e.iConnection,
              preference:      e.preference,
              weight:          e.weight,
            });
            const j = await r.json();
            if (j?.success) added++;
          } catch {}
        }
        toast({ title: "Routing group created", description: `${added}/${pendingEntries.length} routing entries added.` });
      } else {
        toast({ title: "Routing group created" });
      }
      setCreateOpen(false); resetRgForm();
      setTimeout(invalidate, 1000);
    },
    onError: (e: any) => toast({ title: "Error creating group", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: object }) => (await apiRequest("PUT", `/api/sippy/routing-groups/${id}`, body)).json(),
    onSuccess: (data: any) => {
      const a = approvalToastOpts(data, navigate);
      if (a) toast(a); else toast({ title: "Routing group updated" });
      setEditTarget(null);
      setTimeout(invalidate, 1000);
    },
    onError: (e: any) => toast({ title: "Error updating group", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/sippy/routing-groups/${id}`)).json(),
    onSuccess: (data: any) => {
      const a = approvalToastOpts(data, navigate);
      if (a) toast(a); else toast({ title: "Routing group deleted" });
      setDeleteTarget(null);
      setTimeout(invalidate, 1000);
    },
    onError: (e: any) => toast({ title: "Error deleting group", description: e.message, variant: "destructive" }),
  });

  const resetRgForm = () => {
    setRgName(""); setRgDescription("");
    setRgMediaRelay("built-in"); setRgTimeout2xx("300");
    setRgLrnEnabled(false); setRgLrnRule("");
    setRgPolicy("prefix,preference");
    setRgOnNetConnection(""); setRgVoicemailConn(""); setRgOnNetScope("all_accounts");
    setRgReplyTimeout("5"); setRgTimeout1xx("10"); setRgOnNetTimeout2xx("60");
    setPendingEntries([]);
  };

  const openEdit = (rg: RoutingGroup) => {
    setEditTarget(rg);
    setRgName(rg.name);
    setRgDescription("");
    setRgMediaRelay(rg.media_relay ?? "built-in");
    setRgTimeout2xx("300");
    setRgLrnEnabled(false);
    setRgLrnRule("");
    // Use the existing policy value directly, falling back to the most common working value
    const existingPolicy = rg.policy ?? "prefix,preference";
    const knownPolicies = RG_POLICY_OPTIONS.map(o => o.value);
    setRgPolicy(knownPolicies.includes(existingPolicy) ? existingPolicy : "prefix,preference");
    setRgOnNetConnection(""); setRgVoicemailConn(""); setRgOnNetScope("all_accounts");
    setRgReplyTimeout("5"); setRgTimeout1xx("10"); setRgOnNetTimeout2xx("60");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search routing groups…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search-rg"
          />
        </div>
        <Button size="sm" className="gap-1.5 h-9 shrink-0" onClick={() => { resetRgForm(); setCreateOpen(true); }}
          data-testid="btn-create-rg">
          <Plus className="h-4 w-4" /> New Group
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading from local cache…</span>
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <GitBranch className="h-8 w-8 opacity-30 mx-auto mb-2" />
          <p className="text-sm">{search ? "No groups match your search" : "No routing groups yet — create one or click Sync Now"}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {groups.map(rg => {
            const isExpanded = expandedId === rg.i_routing_group;
            return (
              <div
                key={rg.i_routing_group}
                data-testid={`rg-row-${rg.i_routing_group}`}
                className="rounded-xl border border-border/50 bg-card/60 overflow-hidden"
              >
                <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <button
                    className="flex items-center gap-4 flex-1 text-left min-w-0"
                    onClick={() => setExpandedId(isExpanded ? null : rg.i_routing_group)}
                    data-testid={`btn-expand-rg-${rg.i_routing_group}`}
                  >
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Route className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{rg.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">#{rg.i_routing_group}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className={`text-xs font-medium ${policyColor(rg.policy)}`}>
                          {policyLabel(rg.policy)}
                        </span>
                        {rg.on_net && (
                          <Badge variant="outline" className="h-4 text-[10px] border-cyan-500/40 text-cyan-400 px-1">On-Net</Badge>
                        )}
                        {rg.media_relay && (
                          <span className="text-xs text-muted-foreground">{rg.media_relay}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right mr-2">
                      <div className="text-sm font-semibold">{rg.members_count}</div>
                      <div className="text-xs text-muted-foreground">members</div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => navigate(`/lcr-analyser?rg=${rg.i_routing_group}`)}
                      className="p-1.5 text-muted-foreground/50 hover:text-violet-400 rounded transition-colors"
                      data-testid={`btn-analyse-rg-${rg.i_routing_group}`} title="Analyse in LCR">
                      <BarChart3 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => openEdit(rg)}
                      className="p-1.5 text-muted-foreground/50 hover:text-foreground rounded transition-colors"
                      data-testid={`btn-edit-rg-${rg.i_routing_group}`} title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setDeleteTarget(rg)}
                      className="p-1.5 text-rose-400/50 hover:text-rose-400 rounded transition-colors"
                      data-testid={`btn-delete-rg-${rg.i_routing_group}`} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <ChevronRight
                      onClick={() => setExpandedId(isExpanded ? null : rg.i_routing_group)}
                      className={cn("h-4 w-4 text-muted-foreground/40 transition-transform duration-200 cursor-pointer", isExpanded && "rotate-90")}
                    />
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-border/40 bg-muted/10 pb-1">
                    <div className="px-4 py-2 flex items-center gap-2 border-b border-border/20">
                      <Server className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Routing Entries
                      </span>
                      <span className="text-[10px] text-muted-foreground/40 ml-1">live from Sippy · vendor → connection → destination set</span>
                    </div>
                    <div className="pt-2">
                      <RgMembersPanel groupId={rg.i_routing_group} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Routing Group</DialogTitle>
            <DialogDescription>Create a routing group on your Sippy softswitch.</DialogDescription>
          </DialogHeader>
          <RgForm
            rgName={rgName} setRgName={setRgName}
            rgDescription={rgDescription} setRgDescription={setRgDescription}
            rgMediaRelay={rgMediaRelay} setRgMediaRelay={setRgMediaRelay}
            rgTimeout2xx={rgTimeout2xx} setRgTimeout2xx={setRgTimeout2xx}
            rgLrnEnabled={rgLrnEnabled} setRgLrnEnabled={setRgLrnEnabled}
            rgLrnRule={rgLrnRule} setRgLrnRule={setRgLrnRule}
            rgPolicy={rgPolicy} setRgPolicy={setRgPolicy}
            rgOnNetConnection={rgOnNetConnection} setRgOnNetConnection={setRgOnNetConnection}
            rgVoicemailConn={rgVoicemailConn} setRgVoicemailConn={setRgVoicemailConn}
            rgOnNetScope={rgOnNetScope} setRgOnNetScope={setRgOnNetScope}
            rgReplyTimeout={rgReplyTimeout} setRgReplyTimeout={setRgReplyTimeout}
            rgTimeout1xx={rgTimeout1xx} setRgTimeout1xx={setRgTimeout1xx}
            rgOnNetTimeout2xx={rgOnNetTimeout2xx} setRgOnNetTimeout2xx={setRgOnNetTimeout2xx}
            idSuffix="create"
            pendingEntries={pendingEntries} setPendingEntries={setPendingEntries}
            cachedConns={rgCachedConns} cachedSets={rgCachedSets}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Discard & Close</Button>
            <Button variant="outline" onClick={() => createMut.mutate({
                name: rgName, policy: rgPolicy,
                ...(rgDescription ? { description: rgDescription } : {}),
                media_relay: rgMediaRelay,
                ...(rgTimeout2xx ? { timeout_2xx: parseInt(rgTimeout2xx) } : {}),
                ...(rgLrnEnabled ? { lrn_enabled: 1 } : {}),
                ...(rgLrnEnabled && rgLrnRule ? { lrn_translation_rule: rgLrnRule } : {}),
                ...(rgOnNetConnection ? { on_net_connection: parseInt(rgOnNetConnection) } : {}),
                ...(rgVoicemailConn ? { voicemail_connection: parseInt(rgVoicemailConn) } : {}),
                on_net_scope: rgOnNetScope,
                ...(rgReplyTimeout ? { reply_timeout: parseInt(rgReplyTimeout) } : {}),
                ...(rgTimeout1xx ? { timeout_1xx: parseInt(rgTimeout1xx) } : {}),
                ...(rgOnNetTimeout2xx ? { on_net_timeout_2xx: parseInt(rgOnNetTimeout2xx) } : {}),
              })}
              disabled={!rgName || !rgPolicy || createMut.isPending} data-testid="btn-confirm-save-rg">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
            <Button onClick={() => createMut.mutate({
                name: rgName, policy: rgPolicy,
                ...(rgDescription ? { description: rgDescription } : {}),
                media_relay: rgMediaRelay,
                ...(rgTimeout2xx ? { timeout_2xx: parseInt(rgTimeout2xx) } : {}),
                ...(rgLrnEnabled ? { lrn_enabled: 1 } : {}),
                ...(rgLrnEnabled && rgLrnRule ? { lrn_translation_rule: rgLrnRule } : {}),
                ...(rgOnNetConnection ? { on_net_connection: parseInt(rgOnNetConnection) } : {}),
                ...(rgVoicemailConn ? { voicemail_connection: parseInt(rgVoicemailConn) } : {}),
                on_net_scope: rgOnNetScope,
                ...(rgReplyTimeout ? { reply_timeout: parseInt(rgReplyTimeout) } : {}),
                ...(rgTimeout1xx ? { timeout_1xx: parseInt(rgTimeout1xx) } : {}),
                ...(rgOnNetTimeout2xx ? { on_net_timeout_2xx: parseInt(rgOnNetTimeout2xx) } : {}),
              })}
              disabled={!rgName || !rgPolicy || createMut.isPending} data-testid="btn-confirm-create-rg">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save & Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={o => !o && setEditTarget(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Routing Group</DialogTitle>
            <DialogDescription>Update parameters for <strong>{editTarget?.name}</strong>.</DialogDescription>
          </DialogHeader>
          <RgForm
            rgName={rgName} setRgName={setRgName}
            rgDescription={rgDescription} setRgDescription={setRgDescription}
            rgMediaRelay={rgMediaRelay} setRgMediaRelay={setRgMediaRelay}
            rgTimeout2xx={rgTimeout2xx} setRgTimeout2xx={setRgTimeout2xx}
            rgLrnEnabled={rgLrnEnabled} setRgLrnEnabled={setRgLrnEnabled}
            rgLrnRule={rgLrnRule} setRgLrnRule={setRgLrnRule}
            rgPolicy={rgPolicy} setRgPolicy={setRgPolicy}
            rgOnNetConnection={rgOnNetConnection} setRgOnNetConnection={setRgOnNetConnection}
            rgVoicemailConn={rgVoicemailConn} setRgVoicemailConn={setRgVoicemailConn}
            rgOnNetScope={rgOnNetScope} setRgOnNetScope={setRgOnNetScope}
            rgReplyTimeout={rgReplyTimeout} setRgReplyTimeout={setRgReplyTimeout}
            rgTimeout1xx={rgTimeout1xx} setRgTimeout1xx={setRgTimeout1xx}
            rgOnNetTimeout2xx={rgOnNetTimeout2xx} setRgOnNetTimeout2xx={setRgOnNetTimeout2xx}
            idSuffix="edit"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => editTarget && updateMut.mutate({ id: editTarget.i_routing_group, body: {
                name: rgName, policy: rgPolicy,
                ...(rgDescription ? { description: rgDescription } : {}),
                media_relay: rgMediaRelay,
                ...(rgTimeout2xx ? { timeout_2xx: parseInt(rgTimeout2xx) } : {}),
                lrn_enabled: rgLrnEnabled ? 1 : 0,
                ...(rgLrnEnabled && rgLrnRule ? { lrn_translation_rule: rgLrnRule } : {}),
                ...(rgOnNetConnection ? { on_net_connection: parseInt(rgOnNetConnection) } : {}),
                ...(rgVoicemailConn ? { voicemail_connection: parseInt(rgVoicemailConn) } : {}),
                on_net_scope: rgOnNetScope,
                ...(rgReplyTimeout ? { reply_timeout: parseInt(rgReplyTimeout) } : {}),
                ...(rgTimeout1xx ? { timeout_1xx: parseInt(rgTimeout1xx) } : {}),
                ...(rgOnNetTimeout2xx ? { on_net_timeout_2xx: parseInt(rgOnNetTimeout2xx) } : {}),
              }})}
              disabled={!rgName || updateMut.isPending} data-testid="btn-confirm-edit-rg">
              {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Routing Group?</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>{deleteTarget?.name}</strong>? This also removes all its members from Sippy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.i_routing_group)}
              disabled={deleteMut.isPending} data-testid="btn-confirm-delete-rg">
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Destination Sets Tab ───────────────────────────────────────────────────────

const DS_CURRENCIES = ["USD", "EUR", "GBP", "AED", "SAR", "PKR", "INR", "BDT", "EGP", "TRY"];

type DsFormProps = {
  dsName: string; setDsName: (v: string) => void;
  dsCurrency: string; setDsCurrency: (v: string) => void;
  dsConnectFee: string; setDsConnectFee: (v: string) => void;
  dsFreeSeconds: string; setDsFreeSeconds: (v: string) => void;
  dsPostCallSurcharge: string; setDsPostCallSurcharge: (v: string) => void;
  dsGracePeriod: string; setDsGracePeriod: (v: string) => void;
  dsLocalCallingEnabled: boolean; setDsLocalCallingEnabled: (v: boolean) => void;
  dsCliValidationRule: string; setDsCliValidationRule: (v: string) => void;
  dsRemoteMgmtType: string; setDsRemoteMgmtType: (v: string) => void;
  dsRemoteMgmtKey: string; setDsRemoteMgmtKey: (v: string) => void;
  idSuffix: string;
};

function DsForm({
  dsName, setDsName,
  dsCurrency, setDsCurrency, dsConnectFee, setDsConnectFee,
  dsFreeSeconds, setDsFreeSeconds, dsPostCallSurcharge, setDsPostCallSurcharge,
  dsGracePeriod, setDsGracePeriod,
  dsLocalCallingEnabled, setDsLocalCallingEnabled,
  dsCliValidationRule, setDsCliValidationRule, dsRemoteMgmtType, setDsRemoteMgmtType,
  dsRemoteMgmtKey, setDsRemoteMgmtKey, idSuffix,
}: DsFormProps) {
  const SectionHeader = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2 py-1 mb-2 border-b border-border/40">
      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
    </div>
  );

  return (
    <div className="space-y-5 py-2">
      {/* Basic Parameters */}
      <div>
        <SectionHeader label="Basic Parameters" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={dsName} onChange={e => setDsName(e.target.value)}
              placeholder="e.g. UK-Mobile" data-testid={`input-ds-name-${idSuffix}`} />
          </div>
          <div className="space-y-1.5">
            <Label>Currency *</Label>
            <Select value={dsCurrency} onValueChange={setDsCurrency}>
              <SelectTrigger data-testid={`select-ds-currency-${idSuffix}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {DS_CURRENCIES_FULL.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Connect Fee</Label>
            <Input type="number" step="0.0001" value={dsConnectFee} onChange={e => setDsConnectFee(e.target.value)}
              placeholder="0.0000" data-testid={`input-ds-connect-fee-${idSuffix}`} />
          </div>
          <div className="space-y-1.5">
            <Label>Free Seconds</Label>
            <Input type="number" value={dsFreeSeconds} onChange={e => setDsFreeSeconds(e.target.value)}
              placeholder="0" data-testid={`input-ds-free-seconds-${idSuffix}`} />
          </div>
          <div className="space-y-1.5">
            <Label>Post Call Surcharge %</Label>
            <Input type="number" step="0.01" value={dsPostCallSurcharge} onChange={e => setDsPostCallSurcharge(e.target.value)}
              placeholder="0.00" data-testid={`input-ds-surcharge-${idSuffix}`} />
          </div>
          <div className="space-y-1.5">
            <Label>Grace Period, sec</Label>
            <Input type="number" value={dsGracePeriod} onChange={e => setDsGracePeriod(e.target.value)}
              placeholder="0" data-testid={`input-ds-grace-period-${idSuffix}`} />
          </div>
        </div>
      </div>

      {/* Local Calling */}
      <div>
        <SectionHeader label="Local Calling" />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <input type="checkbox" id={`chk-lc-${idSuffix}`} checked={dsLocalCallingEnabled}
              onChange={e => setDsLocalCallingEnabled(e.target.checked)}
              className="h-4 w-4 accent-primary" data-testid={`chk-ds-local-calling-${idSuffix}`} />
            <label htmlFor={`chk-lc-${idSuffix}`} className="text-sm font-medium cursor-pointer">Enabled</label>
          </div>
          <div className="space-y-1.5">
            <Label>CLI Validation Rule</Label>
            <Input value={dsCliValidationRule} onChange={e => setDsCliValidationRule(e.target.value)}
              disabled={!dsLocalCallingEnabled}
              placeholder={dsLocalCallingEnabled ? "e.g. ^44[0-9]{9}$" : "Enable local calling first"}
              className="disabled:opacity-40"
              data-testid={`input-ds-cli-validation-${idSuffix}`} />
          </div>
        </div>
      </div>

      {/* Remote Management */}
      <div>
        <SectionHeader label="Remote Management" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={dsRemoteMgmtType} onValueChange={setDsRemoteMgmtType}>
              <SelectTrigger data-testid={`select-ds-remote-mgmt-${idSuffix}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {REMOTE_MGMT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Key</Label>
            <Input value={dsRemoteMgmtKey} onChange={e => setDsRemoteMgmtKey(e.target.value)}
              disabled={dsRemoteMgmtType === "disabled"}
              placeholder={dsRemoteMgmtType === "disabled" ? "N/A" : "Remote management key"}
              className="disabled:opacity-40"
              data-testid={`input-ds-remote-key-${idSuffix}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DestinationSetsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DestinationSet | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DestinationSet | null>(null);
  const [dsName, setDsName] = useState("");
  const [dsCurrency, setDsCurrency] = useState("USD");
  const [dsCldTrans, setDsCldTrans] = useState("");
  const [dsCliTrans, setDsCliTrans] = useState("");
  const [dsDescription, setDsDescription] = useState("");
  const [dsConnectFee, setDsConnectFee] = useState("");
  const [dsFreeSeconds, setDsFreeSeconds] = useState("");
  const [dsGracePeriod, setDsGracePeriod] = useState("");
  const [dsPostCallSurcharge, setDsPostCallSurcharge] = useState("");
  const [dsLocalCallingEnabled, setDsLocalCallingEnabled] = useState(false);
  const [dsCliValidationRule, setDsCliValidationRule] = useState("");
  const [dsRemoteMgmtType, setDsRemoteMgmtType] = useState("disabled");
  const [dsRemoteMgmtKey, setDsRemoteMgmtKey] = useState("");

  const { data, isLoading } = useQuery<{ sets: DestinationSet[] }>({
    queryKey: ["/api/routing-cache/destination-sets"],
  });
  const sets = (data?.sets ?? []).filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleRunLcr = (prefix: string) => {
    navigate(`/lcr-analyser?prefix=${encodeURIComponent(prefix)}`);
  };

  const invalidate = async () => {
    try { await apiRequest("POST", "/api/routing-cache/sync"); } catch { /* swallow */ }
    qc.invalidateQueries({ queryKey: ["/api/routing-cache/destination-sets"] });
    qc.invalidateQueries({ queryKey: ["/api/routing-cache/status"] });
  };

  const createMut = useMutation({
    mutationFn: async (body: object) => (await apiRequest("POST", "/api/sippy/destination-sets", body)).json(),
    onSuccess: (data: any) => {
      const a = approvalToastOpts(data, navigate);
      if (a) toast(a); else toast({ title: "Destination set created" });
      setCreateOpen(false); setDsName(""); setDsCurrency("USD"); setDsCldTrans(""); setDsCliTrans(""); setDsDescription(""); setDsConnectFee(""); setDsFreeSeconds(""); setDsGracePeriod(""); setDsPostCallSurcharge(""); setDsLocalCallingEnabled(false); setDsCliValidationRule(""); setDsRemoteMgmtType("disabled"); setDsRemoteMgmtKey("");
      setTimeout(invalidate, 1000);
    },
    onError: (e: any) => toast({ title: "Error creating destination set", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: object }) => (await apiRequest("PATCH", `/api/sippy/destination-sets/${id}`, body)).json(),
    onSuccess: (data: any) => {
      const a = approvalToastOpts(data, navigate);
      if (a) toast(a); else toast({ title: "Destination set updated" });
      setEditTarget(null);
      setTimeout(invalidate, 1000);
    },
    onError: (e: any) => toast({ title: "Error updating destination set", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/sippy/destination-sets/${id}`)).json(),
    onSuccess: (data: any) => {
      const a = approvalToastOpts(data, navigate);
      if (a) toast(a); else toast({ title: "Destination set deleted" });
      setDeleteTarget(null);
      setTimeout(invalidate, 1000);
    },
    onError: (e: any) => toast({ title: "Error deleting destination set", description: e.message, variant: "destructive" }),
  });

  const resetDsForm = () => {
    setDsName(""); setDsCurrency("USD");
    setDsCldTrans(""); setDsCliTrans(""); setDsDescription("");
    setDsConnectFee(""); setDsFreeSeconds(""); setDsGracePeriod("");
    setDsPostCallSurcharge(""); setDsLocalCallingEnabled(false);
    setDsCliValidationRule(""); setDsRemoteMgmtType("disabled"); setDsRemoteMgmtKey("");
  };

  const openEdit = (ds: DestinationSet) => {
    setEditTarget(ds);
    setDsName(ds.name);
    setDsCurrency(ds.currency ?? "USD");
    setDsCldTrans(ds.cld_translation ?? "");
    setDsCliTrans(ds.cli_translation ?? "");
    setDsDescription(ds.description ?? "");
    setDsConnectFee(ds.connect_fee != null ? String(ds.connect_fee) : "");
    setDsFreeSeconds(ds.free_seconds != null ? String(ds.free_seconds) : "");
    setDsGracePeriod(ds.grace_period != null ? String(ds.grace_period) : "");
    setDsPostCallSurcharge(""); setDsLocalCallingEnabled(false);
    setDsCliValidationRule(""); setDsRemoteMgmtType("disabled"); setDsRemoteMgmtKey("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search destination sets…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search-ds"
          />
        </div>
        <Button size="sm" className="gap-1.5 h-9 shrink-0"
          onClick={() => { resetDsForm(); setCreateOpen(true); }}
          data-testid="btn-create-ds">
          <Plus className="h-4 w-4" /> New Dest Set
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading from local cache…</span>
        </div>
      ) : sets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Layers className="h-8 w-8 opacity-30 mx-auto mb-2" />
          <p className="text-sm">{search ? "No sets match your search" : "No destination sets yet — create one or Sync Now"}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sets.map(ds => {
            const isExpanded = expandedId === ds.i_destination_set;
            return (
              <div
                key={ds.i_destination_set}
                data-testid={`ds-row-${ds.i_destination_set}`}
                className="rounded-xl border border-border/50 bg-card/60 overflow-hidden"
              >
                <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <button
                    className="flex items-center gap-4 flex-1 text-left min-w-0"
                    onClick={() => setExpandedId(isExpanded ? null : ds.i_destination_set)}
                    data-testid={`btn-expand-ds-${ds.i_destination_set}`}
                  >
                    <div className="h-9 w-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                      <Layers className="h-4 w-4 text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{ds.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">#{ds.i_destination_set}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {ds.cld_translation && (
                          <span className="text-xs text-muted-foreground font-mono">
                            CLD: <span className="text-cyan-400">{ds.cld_translation}</span>
                          </span>
                        )}
                        {ds.cli_translation && (
                          <span className="text-xs text-muted-foreground font-mono">
                            CLI: <span className="text-amber-400">{ds.cli_translation}</span>
                          </span>
                        )}
                        {!ds.cld_translation && !ds.cli_translation && (
                          <span className="text-xs text-muted-foreground/40">no translation rules</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right mr-2">
                      <div className="text-sm font-semibold">{ds.route_count}</div>
                      <div className="text-xs text-muted-foreground">routes</div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(ds)}
                      className="p-1.5 text-muted-foreground/50 hover:text-foreground rounded transition-colors"
                      data-testid={`btn-edit-ds-${ds.i_destination_set}`} title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setDeleteTarget(ds)}
                      className="p-1.5 text-rose-400/50 hover:text-rose-400 rounded transition-colors"
                      data-testid={`btn-delete-ds-${ds.i_destination_set}`} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <ChevronRight
                      onClick={() => setExpandedId(isExpanded ? null : ds.i_destination_set)}
                      className={cn("h-4 w-4 text-muted-foreground/40 transition-transform duration-200 cursor-pointer", isExpanded && "rotate-90")}
                    />
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-border/40 bg-muted/10 pb-1">
                    <div className="px-4 py-2 flex items-center gap-2 border-b border-border/20">
                      <Network className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Prefix Routes
                      </span>
                      <span className="text-[10px] text-muted-foreground/40 ml-1">click Run LCR to analyse a prefix</span>
                    </div>
                    <div className="pt-2">
                      <DsRoutesPanel dsId={ds.i_destination_set} onRunLcr={handleRunLcr} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Destination Set</DialogTitle>
            <DialogDescription>Create a destination set (prefix/rate group) on Sippy.</DialogDescription>
          </DialogHeader>
          <DsForm
            dsName={dsName} setDsName={setDsName}
            dsCurrency={dsCurrency} setDsCurrency={setDsCurrency}
            dsConnectFee={dsConnectFee} setDsConnectFee={setDsConnectFee}
            dsFreeSeconds={dsFreeSeconds} setDsFreeSeconds={setDsFreeSeconds}
            dsPostCallSurcharge={dsPostCallSurcharge} setDsPostCallSurcharge={setDsPostCallSurcharge}
            dsGracePeriod={dsGracePeriod} setDsGracePeriod={setDsGracePeriod}
            dsLocalCallingEnabled={dsLocalCallingEnabled} setDsLocalCallingEnabled={setDsLocalCallingEnabled}
            dsCliValidationRule={dsCliValidationRule} setDsCliValidationRule={setDsCliValidationRule}
            dsRemoteMgmtType={dsRemoteMgmtType} setDsRemoteMgmtType={setDsRemoteMgmtType}
            dsRemoteMgmtKey={dsRemoteMgmtKey} setDsRemoteMgmtKey={setDsRemoteMgmtKey}
            idSuffix="create"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Discard & Close</Button>
            <Button onClick={() => createMut.mutate({
                name: dsName, currency: dsCurrency,
                ...(dsDescription ? { description: dsDescription } : {}),
                ...(dsConnectFee ? { connect_fee: parseFloat(dsConnectFee) } : {}),
                ...(dsFreeSeconds ? { free_seconds: parseInt(dsFreeSeconds) } : {}),
                ...(dsPostCallSurcharge ? { post_call_surcharge: parseFloat(dsPostCallSurcharge) } : {}),
                ...(dsGracePeriod ? { grace_period: parseInt(dsGracePeriod) } : {}),
                ...(dsCldTrans ? { cld_translation: dsCldTrans } : {}),
                ...(dsCliTrans ? { cli_translation: dsCliTrans } : {}),
                local_calling_enabled: dsLocalCallingEnabled ? 1 : 0,
                ...(dsLocalCallingEnabled && dsCliValidationRule ? { cli_validation_rule: dsCliValidationRule } : {}),
                remote_mgmt_type: dsRemoteMgmtType,
                ...(dsRemoteMgmtType !== "disabled" && dsRemoteMgmtKey ? { remote_mgmt_key: dsRemoteMgmtKey } : {}),
              })}
              disabled={!dsName || !dsCurrency || createMut.isPending} data-testid="btn-confirm-create-ds">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={o => !o && setEditTarget(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Destination Set</DialogTitle>
            <DialogDescription>Update parameters for <strong>{editTarget?.name}</strong>.</DialogDescription>
          </DialogHeader>
          <DsForm
            dsName={dsName} setDsName={setDsName}
            dsCurrency={dsCurrency} setDsCurrency={setDsCurrency}
            dsConnectFee={dsConnectFee} setDsConnectFee={setDsConnectFee}
            dsFreeSeconds={dsFreeSeconds} setDsFreeSeconds={setDsFreeSeconds}
            dsPostCallSurcharge={dsPostCallSurcharge} setDsPostCallSurcharge={setDsPostCallSurcharge}
            dsGracePeriod={dsGracePeriod} setDsGracePeriod={setDsGracePeriod}
            dsLocalCallingEnabled={dsLocalCallingEnabled} setDsLocalCallingEnabled={setDsLocalCallingEnabled}
            dsCliValidationRule={dsCliValidationRule} setDsCliValidationRule={setDsCliValidationRule}
            dsRemoteMgmtType={dsRemoteMgmtType} setDsRemoteMgmtType={setDsRemoteMgmtType}
            dsRemoteMgmtKey={dsRemoteMgmtKey} setDsRemoteMgmtKey={setDsRemoteMgmtKey}
            idSuffix="edit"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => editTarget && updateMut.mutate({
                id: editTarget.i_destination_set,
                body: {
                  name: dsName, currency: dsCurrency,
                  ...(dsDescription ? { description: dsDescription } : {}),
                  ...(dsConnectFee ? { connect_fee: parseFloat(dsConnectFee) } : {}),
                  ...(dsFreeSeconds ? { free_seconds: parseInt(dsFreeSeconds) } : {}),
                  ...(dsPostCallSurcharge ? { post_call_surcharge: parseFloat(dsPostCallSurcharge) } : {}),
                  ...(dsGracePeriod ? { grace_period: parseInt(dsGracePeriod) } : {}),
                  ...(dsCldTrans ? { cld_translation: dsCldTrans } : {}),
                  ...(dsCliTrans ? { cli_translation: dsCliTrans } : {}),
                  local_calling_enabled: dsLocalCallingEnabled ? 1 : 0,
                  ...(dsLocalCallingEnabled && dsCliValidationRule ? { cli_validation_rule: dsCliValidationRule } : {}),
                  remote_mgmt_type: dsRemoteMgmtType,
                  ...(dsRemoteMgmtType !== "disabled" && dsRemoteMgmtKey ? { remote_mgmt_key: dsRemoteMgmtKey } : {}),
                }
              })}
              disabled={!dsName || updateMut.isPending} data-testid="btn-confirm-edit-ds">
              {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Destination Set?</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>{deleteTarget?.name}</strong> and all its routes from Sippy?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.i_destination_set)}
              disabled={deleteMut.isPending} data-testid="btn-confirm-delete-ds">
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Coverage Map View ──────────────────────────────────────────────────────────

function CoverageMapView() {
  const [openGap, setOpenGap] = useState<'unused' | 'orphan' | 'single' | null>(null);

  const { data, isLoading, isFetching, refetch, error } = useQuery<CoverageMatrix>({
    queryKey: ["/api/coverage/matrix"],
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });

  const g = data?.gaps;
  const totalGaps = (g?.unusedConnections.length ?? 0) + (g?.orphanDSets.length ?? 0) + (g?.singleCoveredDSets.length ?? 0);

  // Build matrix: rows = connections, cols = DS — O(C × DS)
  const matrixConns = data?.connections.filter(c => !c.blocked) ?? [];
  const matrixDSets = data?.destinationSets ?? [];

  // For a cell: is conn X linked to DS Y?
  const linked = (iConn: number, iDS: number) =>
    data?.connections.find(c => c.iConnection === iConn)?.coveredDSets.some(d => d.iDS === iDS) ?? false;

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <p className="text-sm">Building coverage map — fetching live routing group members…</p>
      <p className="text-[10px]">This makes one API call per routing group. Please wait.</p>
    </div>
  );

  if (error || !data) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <AlertCircle className="h-8 w-8 text-destructive/60" />
      <p className="text-sm font-medium">Failed to build coverage map</p>
      <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{data.connections.length} connections</span>
          <span>·</span>
          <span>{data.destinationSets.length} destination sets</span>
          <span>·</span>
          <span>{data.rgCount} routing groups</span>
          {data.failedRGs > 0 && (
            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
              {data.failedRGs} RGs skipped
            </Badge>
          )}
          <span className="text-muted-foreground/40">({data.buildTimeMs}ms)</span>
        </div>
        <Button
          size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="btn-coverage-refresh"
        >
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Gap Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => setOpenGap(openGap === 'unused' ? null : 'unused')}
          data-testid="card-gap-unused"
          className={cn(
            "text-left p-4 rounded-xl border transition-colors space-y-1.5",
            g!.unusedConnections.length > 0
              ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/15"
              : "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Unused Connections</span>
            <ShieldAlert className={cn("h-3.5 w-3.5", g!.unusedConnections.length > 0 ? "text-red-400" : "text-emerald-400")} />
          </div>
          <p className={cn("text-2xl font-bold tabular-nums", g!.unusedConnections.length > 0 ? "text-red-400" : "text-emerald-400")}>
            {g!.unusedConnections.length}
          </p>
          <p className="text-[10px] text-muted-foreground">connections not in any routing group</p>
        </button>

        <button
          onClick={() => setOpenGap(openGap === 'orphan' ? null : 'orphan')}
          data-testid="card-gap-orphan"
          className={cn(
            "text-left p-4 rounded-xl border transition-colors space-y-1.5",
            g!.orphanDSets.length > 0
              ? "bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15"
              : "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Orphan Dest Sets</span>
            <XCircle className={cn("h-3.5 w-3.5", g!.orphanDSets.length > 0 ? "text-amber-400" : "text-emerald-400")} />
          </div>
          <p className={cn("text-2xl font-bold tabular-nums", g!.orphanDSets.length > 0 ? "text-amber-400" : "text-emerald-400")}>
            {g!.orphanDSets.length}
          </p>
          <p className="text-[10px] text-muted-foreground">destination sets with no connections</p>
        </button>

        <button
          onClick={() => setOpenGap(openGap === 'single' ? null : 'single')}
          data-testid="card-gap-single"
          className={cn(
            "text-left p-4 rounded-xl border transition-colors space-y-1.5",
            g!.singleCoveredDSets.length > 0
              ? "bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/15"
              : "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Redundancy Gaps</span>
            <Shield className={cn("h-3.5 w-3.5", g!.singleCoveredDSets.length > 0 ? "text-blue-400" : "text-emerald-400")} />
          </div>
          <p className={cn("text-2xl font-bold tabular-nums", g!.singleCoveredDSets.length > 0 ? "text-blue-400" : "text-emerald-400")}>
            {g!.singleCoveredDSets.length}
          </p>
          <p className="text-[10px] text-muted-foreground">dest sets with only 1 connection</p>
        </button>
      </div>

      {/* Gap Detail Panel (collapsible) */}
      {openGap === 'unused' && g!.unusedConnections.length > 0 && (
        <div className="border border-red-500/30 rounded-xl overflow-hidden">
          <div className="bg-red-500/10 px-4 py-2 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-400" />
            <span className="text-sm font-semibold text-red-400">Unused Connections</span>
            <span className="text-xs text-muted-foreground ml-1">— not assigned to any routing group member</span>
          </div>
          <div className="divide-y divide-border/30">
            {g!.unusedConnections.map(c => (
              <div key={c.iConnection} className="flex items-center gap-3 px-4 py-2.5" data-testid={`gap-unused-${c.iConnection}`}>
                <div className={cn("h-2 w-2 rounded-full shrink-0", c.blocked ? "bg-rose-500" : "bg-slate-500")} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground font-mono ml-1.5">#{c.iConnection}</span>
                  {c.host && <span className="text-xs text-muted-foreground/60 font-mono ml-2">{c.host}</span>}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{c.vendorName ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {openGap === 'orphan' && g!.orphanDSets.length > 0 && (
        <div className="border border-amber-500/30 rounded-xl overflow-hidden">
          <div className="bg-amber-500/10 px-4 py-2 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-400">Orphan Destination Sets</span>
            <span className="text-xs text-muted-foreground ml-1">— no connection routes to these sets</span>
          </div>
          <div className="divide-y divide-border/30">
            {g!.orphanDSets.map(ds => (
              <div key={ds.iDS} className="flex items-center gap-3 px-4 py-2.5" data-testid={`gap-orphan-${ds.iDS}`}>
                <Layers className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{ds.name}</span>
                  <span className="text-xs text-muted-foreground font-mono ml-1.5">#{ds.iDS}</span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{ds.routeCount} routes</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {openGap === 'single' && g!.singleCoveredDSets.length > 0 && (
        <div className="border border-blue-500/30 rounded-xl overflow-hidden">
          <div className="bg-blue-500/10 px-4 py-2 flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-semibold text-blue-400">Redundancy Gaps</span>
            <span className="text-xs text-muted-foreground ml-1">— single connection creates SPOF risk</span>
          </div>
          <div className="divide-y divide-border/30">
            {g!.singleCoveredDSets.map(ds => (
              <div key={ds.iDS} className="flex items-center gap-3 px-4 py-2.5" data-testid={`gap-single-${ds.iDS}`}>
                <Layers className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{ds.name}</span>
                  <span className="text-xs text-muted-foreground font-mono ml-1.5">#{ds.iDS}</span>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-blue-400 font-medium">{ds.connectedConnections[0]?.connName}</p>
                  <p className="text-[10px] text-muted-foreground">{ds.connectedConnections[0]?.vendorName}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All-clear banner */}
      {totalGaps === 0 && (
        <div className="flex items-center gap-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2.5 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>No coverage gaps detected — all connections are assigned and all destination sets have redundant coverage.</span>
        </div>
      )}

      {/* Coverage Matrix */}
      {matrixConns.length > 0 && matrixDSets.length > 0 && (
        <div className="border border-border/40 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-muted/30 border-b border-border/30 flex items-center gap-2">
            <Grid3X3 className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Connection × Destination Set Matrix
            </span>
            <span className="text-[10px] text-muted-foreground/50 ml-1">
              ● = linked via routing group · blocked connections hidden
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="table-coverage-matrix">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-muted/40 border-b border-r border-border/30 px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground min-w-[180px]">
                    Connection / Vendor
                  </th>
                  {matrixDSets.map(ds => (
                    <th
                      key={ds.iDS}
                      className="border-b border-r border-border/20 px-2 py-2 text-center min-w-[80px] max-w-[100px]"
                      title={`${ds.name} · ${ds.routeCount} routes`}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[9px] font-semibold text-muted-foreground truncate max-w-[70px]" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', height: '60px' }}>
                          {ds.name}
                        </span>
                        <span className="text-[8px] text-muted-foreground/50">{ds.routeCount}r</span>
                      </div>
                    </th>
                  ))}
                  <th className="border-b border-border/30 px-2 py-2 text-center text-[10px] font-semibold text-muted-foreground min-w-[60px]">
                    Coverage
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrixConns.map((conn, rowIdx) => {
                  const coverageCount = matrixDSets.filter(ds => linked(conn.iConnection, ds.iDS)).length;
                  return (
                    <tr
                      key={conn.iConnection}
                      className={cn("hover:bg-muted/20 transition-colors", rowIdx % 2 === 0 ? "bg-background" : "bg-muted/10")}
                      data-testid={`matrix-row-${conn.iConnection}`}
                    >
                      <td className="sticky left-0 border-b border-r border-border/20 px-3 py-2 min-w-[180px]"
                        style={{ background: 'var(--background)' }}>
                        <div>
                          <p className="font-medium truncate max-w-[160px]">{conn.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[160px]">{conn.vendorName ?? '—'}</p>
                        </div>
                      </td>
                      {matrixDSets.map(ds => {
                        const isLinked = linked(conn.iConnection, ds.iDS);
                        const ref = conn.coveredDSets.find(d => d.iDS === ds.iDS);
                        return (
                          <td
                            key={ds.iDS}
                            className="border-b border-r border-border/15 text-center py-2 px-1"
                            title={isLinked ? `via ${ref?.rgName ?? 'RG'} · pref ${ref?.preference ?? '—'}` : 'Not linked'}
                            data-testid={`matrix-cell-${conn.iConnection}-${ds.iDS}`}
                          >
                            {isLinked ? (
                              <div className="flex items-center justify-center">
                                <div className="h-3.5 w-3.5 rounded-full bg-emerald-500/80 flex items-center justify-center text-[8px] font-bold text-white" title={`Pref: ${ref?.preference ?? '—'}`}>
                                  ✓
                                </div>
                              </div>
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-sm bg-muted/30 mx-auto" />
                            )}
                          </td>
                        );
                      })}
                      <td className="border-b border-border/20 text-center py-2 px-2">
                        <span className={cn("text-xs font-bold tabular-nums",
                          coverageCount === 0 ? "text-red-400"
                          : coverageCount === matrixDSets.length ? "text-emerald-400" : "text-amber-400"
                        )}>
                          {coverageCount}/{matrixDSets.length}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Per-DS coverage summary row */}
          <div className="border-t border-border/30 bg-muted/20 flex items-center gap-0 overflow-x-auto">
            <div className="sticky left-0 bg-muted/40 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground min-w-[180px] shrink-0">
              Connections per DS
            </div>
            {matrixDSets.map(ds => {
              const cnt = ds.connectedConnections.filter(c => {
                const conn = data.connections.find(x => x.iConnection === c.iConnection);
                return !conn?.blocked;
              }).length;
              return (
                <div key={ds.iDS} className="min-w-[80px] text-center py-1.5 border-l border-border/20 text-[10px] font-bold tabular-nums"
                  style={{ color: cnt === 0 ? '#f87171' : cnt === 1 ? '#fbbf24' : '#34d399' }}>
                  {cnt}
                </div>
              );
            })}
            <div className="min-w-[60px]" />
          </div>
        </div>
      )}

      {/* No data */}
      {data.connections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Network className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No connections in cache — run a routing cache sync first</p>
        </div>
      )}
    </div>
  );
}

// ── Connections Tab ────────────────────────────────────────────────────────────

type SippyVendorItem = { iVendor: number; name: string };

function ConnectionsTab() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<'list' | 'coverage'>('list');
  const [search, setSearch] = useState("");
  const [showBlocked, setShowBlocked] = useState(true);

  // ── Add Vendor dialog state ──
  const [vendorOpen, setVendorOpen] = useState(false);
  const [vName,     setVName]     = useState("");
  const [vLogin,    setVLogin]    = useState("");
  const [vPass,     setVPass]     = useState("");
  const [vCurrency, setVCurrency] = useState("USD");

  // ── Add Connection dialog state ──
  const [connOpen,       setConnOpen]       = useState(false);
  const [connVendorId,   setConnVendorId]   = useState<number | null>(null);
  const [connVendorName, setConnVendorName] = useState("");
  const [cName,          setCName]          = useState("");
  const [cProto,         setCProto]         = useState("SIP");
  const [cDest,          setCDest]          = useState("");
  const [cUser,          setCUser]          = useState("");
  const [cPass,          setCPass]          = useState("");
  const [cCapacity,      setCCapacity]      = useState("");
  const [cEnforceCap,    setCEnforceCap]    = useState(false);
  const [cMaxCps,        setCMaxCps]        = useState("");
  const [cBlocked,       setCBlocked]       = useState(false);
  const [cCld,           setCCld]           = useState("");
  const [cCli,           setCCli]           = useState("");
  const [cProxy,         setCProxy]         = useState("");
  const [cMediaRelay,    setCMediaRelay]    = useState("1");

  const { data, isLoading } = useQuery<{ connections: Connection[] }>({
    queryKey: ["/api/routing-cache/connections"],
  });

  // Vendor list for connection dialog dropdown (only loaded when needed)
  const { data: vendorsData } = useQuery<{ vendors: SippyVendorItem[] }>({
    queryKey: ["/api/sippy/vendors"],
    enabled: connOpen && connVendorId === null,
    select: (d: any) => ({
      vendors: (d.vendors ?? []).map((v: any) => ({ iVendor: v.iVendor ?? v.i_vendor, name: v.name }))
    }),
  });

  const afterCreate = async () => {
    try { await apiRequest("POST", "/api/routing-cache/sync"); } catch { /* best-effort */ }
    queryClient.invalidateQueries({ queryKey: ["/api/routing-cache/connections"] });
  };

  const addVendorMut = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/sippy/vendors", body),
    onSuccess: async (res: any) => {
      const d = await res.json().catch(() => ({}));
      if (d.success === false) { toast({ variant: "destructive", title: "Failed", description: d.error ?? d.message }); return; }
      const createdName = vName;
      const createdId   = d.iVendor as number | undefined;
      setVendorOpen(false); setVName(""); setVLogin(""); setVPass(""); setVCurrency("USD");
      queryClient.invalidateQueries({ queryKey: ["/api/sippy/vendors"] });
      afterCreate();
      // Immediately open Add Connection dialog pre-selected on the new vendor
      if (createdId) {
        setCName(""); setCProto("SIP"); setCDest(""); setCUser(""); setCPass("");
        setCCapacity(""); setCEnforceCap(false); setCMaxCps(""); setCBlocked(false);
        setCCld(""); setCCli(""); setCProxy(""); setCMediaRelay("1");
        setConnVendorId(createdId);
        setConnVendorName(createdName);
        setConnOpen(true);
        toast({ title: `Vendor "${createdName}" created`, description: "Now add at least one connection to it." });
      } else {
        toast({ title: "Vendor created", description: `${createdName} added to Sippy. Use "Add Connection" to add connections to it.` });
      }
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const addConnMut = useMutation({
    mutationFn: ({ vendorId, body }: { vendorId: number; body: object }) =>
      apiRequest("POST", `/api/sippy/vendors/${vendorId}/connections`, body),
    onSuccess: async (res: any) => {
      const d = await res.json().catch(() => ({}));
      if (d.success === false) { toast({ variant: "destructive", title: "Failed", description: d.error ?? d.message }); return; }
      toast({ title: "Connection created", description: `${cName} added to Sippy.` });
      setConnOpen(false);
      setCName(""); setCProto("SIP"); setCDest(""); setCUser(""); setCPass("");
      setCCapacity(""); setCEnforceCap(false); setCMaxCps(""); setCBlocked(false);
      setCCld(""); setCCli(""); setCProxy(""); setCMediaRelay("1");
      await afterCreate();
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const openAddConn = (vendorId: number, vendorName: string) => {
    setConnVendorId(vendorId); setConnVendorName(vendorName);
    setCName(""); setCProto("SIP"); setCDest(""); setCUser(""); setCPass("");
    setCCapacity(""); setCEnforceCap(false); setCMaxCps(""); setCBlocked(false);
    setCCld(""); setCCli(""); setCProxy(""); setCMediaRelay("1");
    setConnOpen(true);
  };

  const connections = (data?.connections ?? []).filter(c => {
    if (!showBlocked && c.blocked) return false;
    return !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.vendor_name ?? "").toLowerCase().includes(search.toLowerCase());
  });

  // Group by vendor
  const byVendor = connections.reduce<Record<string, Connection[]>>((acc, c) => {
    const key = c.vendor_name ?? "Unknown";
    (acc[key] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {/* Toolbar row */}
      <div className="flex gap-2 items-center flex-wrap">
        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-muted/40 border border-border/40 rounded-lg p-1 shrink-0">
          <button
            onClick={() => setViewMode('list')}
            data-testid="btn-view-list"
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors",
              viewMode === 'list'
                ? "bg-background text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
          <button
            onClick={() => setViewMode('coverage')}
            data-testid="btn-view-coverage"
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors",
              viewMode === 'coverage'
                ? "bg-background text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Grid3X3 className="h-3.5 w-3.5" />
            Coverage Map
          </button>
        </div>

        {viewMode === 'list' && (
          <>
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search connections or vendors…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
                data-testid="input-search-conn"
              />
            </div>
            <Button
              size="sm"
              variant={showBlocked ? "outline" : "default"}
              onClick={() => setShowBlocked(o => !o)}
              className="gap-1.5 h-9 text-xs shrink-0"
              data-testid="btn-toggle-blocked"
            >
              <Filter className="h-3.5 w-3.5" />
              {showBlocked ? "Hide Blocked" : "Show Blocked"}
            </Button>
          </>
        )}

        <div className="flex gap-2 ml-auto shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setConnVendorId(null); setConnVendorName(""); setCName(""); setCProto("SIP"); setCDest(""); setCUser(""); setCPass(""); setCCapacity(""); setCEnforceCap(false); setCMaxCps(""); setCBlocked(false); setCCld(""); setCCli(""); setCProxy(""); setCMediaRelay("1"); setConnOpen(true); }}
            className="gap-1.5 h-9 text-xs"
            data-testid="btn-add-connection"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Connection
          </Button>
          <Button
            size="sm"
            onClick={() => { setVName(""); setVLogin(""); setVPass(""); setVCurrency("USD"); setVendorOpen(true); }}
            className="gap-1.5 h-9 text-xs"
            data-testid="btn-add-vendor"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Vendor
          </Button>
        </div>
      </div>

      {/* Coverage Map view */}
      {viewMode === 'coverage' && <CoverageMapView />}

      {/* List view */}
      {viewMode === 'list' && (isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading from local cache…</span>
        </div>
      ) : Object.keys(byVendor).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Network className="h-8 w-8 opacity-30 mx-auto mb-2" />
          <p className="text-sm">{search ? "No connections match your search" : "No connections cached yet — use Add Vendor to get started."}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(byVendor).map(([vendor, conns]) => {
            const vendorId = conns[0]?.i_vendor;
            return (
              <div key={vendor} className="space-y-1.5">
                <div className="flex items-center gap-2 px-1">
                  <Server className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{vendor}</span>
                  <span className="text-xs text-muted-foreground/50">({conns.length})</span>
                  {vendorId != null && (
                    <button
                      data-testid={`btn-add-conn-vendor-${vendorId}`}
                      onClick={() => openAddConn(vendorId, vendor)}
                      className="ml-auto flex items-center gap-1 text-[10px] font-medium text-primary/60 hover:text-primary transition-colors px-1.5 py-0.5 rounded border border-border/40 hover:border-primary/40"
                      title={`Add connection to ${vendor}`}
                    >
                      <Plus className="h-3 w-3" />
                      Add Connection
                    </button>
                  )}
                </div>
                {conns.map(conn => (
                  <div
                    key={conn.i_connection}
                    data-testid={`conn-row-${conn.i_connection}`}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
                      conn.blocked
                        ? "border-rose-500/30 bg-rose-500/5"
                        : "border-border/50 bg-card/60 hover:bg-card"
                    }`}
                  >
                    <div className={`h-2 w-2 rounded-full shrink-0 ${conn.blocked ? "bg-rose-500" : "bg-emerald-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{conn.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">#{conn.i_connection}</span>
                        {conn.blocked && (
                          <Badge variant="destructive" className="h-4 text-[10px] px-1">Blocked</Badge>
                        )}
                      </div>
                      {conn.host && (
                        <span className="text-xs text-muted-foreground font-mono">{conn.host}</span>
                      )}
                    </div>
                    {conn.protocol && (
                      <span className="text-xs text-muted-foreground/60 font-mono shrink-0">{conn.protocol}</span>
                    )}
                    <div className="flex items-center gap-1 shrink-0 ml-auto">
                      <button
                        data-testid={`btn-billing-conn-${conn.i_connection}`}
                        onClick={() => navigate(`/billing?connection=${conn.i_connection}`)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400/70 hover:text-emerald-400 transition-colors px-1.5 py-0.5 rounded"
                        title="View Billing"
                      >
                        <DollarSign className="h-3 w-3" />
                      </button>
                      <button
                        data-testid={`btn-fraud-conn-${conn.i_connection}`}
                        onClick={() => navigate(`/fraud?connection=${conn.i_connection}`)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-amber-400/70 hover:text-amber-400 transition-colors px-1.5 py-0.5 rounded"
                        title="Fraud Check"
                      >
                        <AlertTriangle className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}

      {/* ── Add Vendor Dialog ─────────────────────────────────────────────── */}
      <Dialog open={vendorOpen} onOpenChange={setVendorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Vendor</DialogTitle>
            <DialogDescription>Creates the vendor on your Sippy softswitch.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/40 pb-1">Basic Parameters</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="v-name">Vendor Name <span className="text-destructive">*</span></Label>
                <Input id="v-name" placeholder="e.g. BICS-PR-PR" value={vName} onChange={e => setVName(e.target.value)} data-testid="input-vendor-name" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-login">Web Login <span className="text-destructive">*</span></Label>
                <Input id="v-login" placeholder="login" value={vLogin} onChange={e => setVLogin(e.target.value)} data-testid="input-vendor-login" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-pass">Web Password <span className="text-destructive">*</span></Label>
                <Input id="v-pass" type="password" placeholder="password" value={vPass} onChange={e => setVPass(e.target.value)} data-testid="input-vendor-password" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-currency">Base Currency</Label>
                <Select value={vCurrency} onValueChange={setVCurrency}>
                  <SelectTrigger id="v-currency" data-testid="select-vendor-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["USD","EUR","GBP","AED","CAD","AUD","JPY","CHF"].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVendorOpen(false)}>Cancel</Button>
            <Button
              disabled={!vName || !vLogin || !vPass || addVendorMut.isPending}
              data-testid="btn-confirm-add-vendor"
              onClick={() => addVendorMut.mutate({ name: vName, webLogin: vLogin, webPassword: vPass, iTimeZone: 1, baseCurrency: vCurrency })}
            >
              {addVendorMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save & Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Connection Dialog ─────────────────────────────────────────── */}
      <Dialog open={connOpen} onOpenChange={setConnOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Connection{connVendorName ? ` — ${connVendorName}` : ""}</DialogTitle>
            <DialogDescription>Creates the vendor connection on your Sippy softswitch.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">

            {/* Vendor selector — only shown when not pre-selected from a group row */}
            {connVendorId === null && (
              <div className="space-y-1">
                <Label htmlFor="c-vendor">Vendor <span className="text-destructive">*</span></Label>
                <Select value={connVendorId !== null ? String(connVendorId) : ""} onValueChange={v => { setConnVendorId(parseInt(v)); setConnVendorName(vendorsData?.vendors.find(x => x.iVendor === parseInt(v))?.name ?? ""); }}>
                  <SelectTrigger id="c-vendor" data-testid="select-conn-vendor"><SelectValue placeholder="Select vendor…" /></SelectTrigger>
                  <SelectContent>
                    {(vendorsData?.vendors ?? []).map(v => (
                      <SelectItem key={v.iVendor} value={String(v.iVendor)}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/40 pb-1">Basic Parameters</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="c-name">Connection Name <span className="text-destructive">*</span></Label>
                <Input id="c-name" placeholder="e.g. BICS-BD-PR-PR" value={cName} onChange={e => setCName(e.target.value)} data-testid="input-conn-name" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-proto">Protocol</Label>
                <Select value={cProto} onValueChange={setCProto}>
                  <SelectTrigger id="c-proto" data-testid="select-conn-proto"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SIP">SIP</SelectItem>
                    <SelectItem value="H323">H323</SelectItem>
                    <SelectItem value="Zap">Zap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3 space-y-1">
                <Label htmlFor="c-dest">Destination (IP or SIP:host) <span className="text-destructive">*</span></Label>
                <Input id="c-dest" placeholder="e.g. 149.20.187.181 or SIP:192.168.1.1" value={cDest} onChange={e => setCDest(e.target.value)} data-testid="input-conn-dest" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-user">Username</Label>
                <Input id="c-user" value={cUser} onChange={e => setCUser(e.target.value)} data-testid="input-conn-user" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-cpass">Password</Label>
                <Input id="c-cpass" type="password" value={cPass} onChange={e => setCPass(e.target.value)} data-testid="input-conn-cpass" />
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/40 pb-1 mt-2">Advanced Parameters</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="c-maxcps">Max CPS</Label>
                <Input id="c-maxcps" placeholder="Unlimited" value={cMaxCps} onChange={e => setCMaxCps(e.target.value)} data-testid="input-conn-maxcps" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-cap">Capacity</Label>
                <Input id="c-cap" placeholder="e.g. 30" value={cCapacity} onChange={e => setCCapacity(e.target.value)} data-testid="input-conn-capacity" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-relay">Use Media Relay</Label>
                <Select value={cMediaRelay} onValueChange={setCMediaRelay}>
                  <SelectTrigger id="c-relay" data-testid="select-conn-relay"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Always</SelectItem>
                    <SelectItem value="0">Never</SelectItem>
                    <SelectItem value="2">If No Direct RTP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-proxy">Outbound Proxy</Label>
                <Input id="c-proxy" placeholder="optional" value={cProxy} onChange={e => setCProxy(e.target.value)} data-testid="input-conn-proxy" />
              </div>
              <div className="flex items-center gap-3 col-span-2 pt-5">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={cEnforceCap} onChange={e => setCEnforceCap(e.target.checked)} data-testid="chk-enforce-cap" className="rounded" />
                  Enforce Capacity
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={cBlocked} onChange={e => setCBlocked(e.target.checked)} data-testid="chk-conn-blocked" className="rounded" />
                  Blocked
                </label>
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/40 pb-1 mt-2">Number Translation</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="c-cld">CLD Translation Rule</Label>
                <Input id="c-cld" placeholder="e.g. s/^1/108011/" value={cCld} onChange={e => setCCld(e.target.value)} data-testid="input-conn-cld" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-cli">CLI Translation Rule</Label>
                <Input id="c-cli" placeholder="optional" value={cCli} onChange={e => setCCli(e.target.value)} data-testid="input-conn-cli" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConnOpen(false)}>Cancel</Button>
            <Button
              disabled={!cName || !cDest || connVendorId === null || addConnMut.isPending}
              data-testid="btn-confirm-add-connection"
              onClick={() => {
                if (connVendorId === null) return;
                const body: Record<string, string | number | boolean> = {
                  name: cName,
                  destination: cDest,
                  ...(cUser         ? { connUsername: cUser }             : {}),
                  ...(cPass         ? { connPassword: cPass }             : {}),
                  ...(cCapacity     ? { capacity: parseInt(cCapacity) }   : {}),
                  ...(cMaxCps       ? { maxCps: parseInt(cMaxCps) }       : {}),
                  ...(cCld          ? { translationRule: cCld }           : {}),
                  ...(cCli          ? { cliTranslationRule: cCli }        : {}),
                  ...(cProxy        ? { outboundProxy: cProxy }           : {}),
                  enforceCapacity: cEnforceCap,
                  blocked: cBlocked,
                  iMediaRelay: parseInt(cMediaRelay),
                };
                addConnMut.mutate({ vendorId: connVendorId, body });
              }}
            >
              {addConnMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save & Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

type TabId = "routing-groups" | "destination-sets" | "connections" | "qbr" | "on-net" | "policy-sim";

const VALID_TABS = new Set<TabId>(["routing-groups","destination-sets","connections","qbr","on-net","policy-sim"]);

const TABS: { id: TabId; label: string; icon: typeof Route; countKey?: keyof CacheMeta }[] = [
  { id: "routing-groups",  label: "Routing Groups",   icon: GitBranch,  countKey: "rg_count"   },
  { id: "destination-sets",label: "Destination Sets", icon: Layers,     countKey: "ds_count"   },
  { id: "connections",     label: "Connections",      icon: Wifi,       countKey: "conn_count" },
  { id: "qbr",             label: "QBR Dashboard",    icon: BarChart3                          },
  { id: "on-net",          label: "On-Net Viewer",    icon: Eye                                },
  { id: "policy-sim",      label: "Policy Simulator", icon: Settings2                          },
];

// ── QbrTab ─────────────────────────────────────────────────────────────────────

function qbrStatusBg(status: QbrVendor['status']) {
  return {
    excellent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    good:      'bg-blue-500/10 text-blue-400 border-blue-500/30',
    degraded:  'bg-amber-500/10 text-amber-400 border-amber-500/30',
    critical:  'bg-red-500/10 text-red-400 border-red-500/30',
  }[status];
}
function qbrStatusText(status: QbrVendor['status']) {
  return {
    excellent: 'text-emerald-400',
    good:      'text-blue-400',
    degraded:  'text-amber-400',
    critical:  'text-red-400',
  }[status];
}
function qbrBar(score: number) {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-blue-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}
function asrBar(asr: number) {
  if (asr >= 70) return 'bg-emerald-500';
  if (asr >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}
function asrText(asr: number) {
  if (asr >= 70) return 'text-emerald-400';
  if (asr >= 50) return 'text-amber-400';
  return 'text-red-400';
}

const QBR_WINDOWS = [
  { h: 1,   label: '1h'  },
  { h: 4,   label: '4h'  },
  { h: 12,  label: '12h' },
  { h: 24,  label: '24h' },
  { h: 72,  label: '3d'  },
  { h: 168, label: '7d'  },
];

function QbrTab() {
  const [, navigate] = useLocation();
  const [hours, setHours] = useState(24);

  const { data, isLoading, refetch, isFetching } = useQuery<QbrData>({
    queryKey: [`/api/qbr/metrics?hours=${hours}`],
    refetchInterval: 60_000,
  });

  const s = data?.summary;

  return (
    <div className="space-y-4">
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-muted/40 border border-border/40 rounded-lg p-1">
          {QBR_WINDOWS.map(w => (
            <button
              key={w.h}
              onClick={() => setHours(w.h)}
              data-testid={`btn-qbr-window-${w.h}`}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                hours === w.h
                  ? "bg-background text-foreground shadow-sm border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {data?.meta.updatedAt && (
            <span>Cache {relTime(data.meta.updatedAt)}</span>
          )}
          <Button
            size="sm" variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => refetch()}
            data-testid="btn-qbr-refresh"
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Loading ───────────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Analysing CDR cache…</span>
        </div>
      )}

      {!isLoading && data && (
        <>
          {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* ASR */}
            <button onClick={() => navigate('/noc')} className="text-left bg-muted/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-primary/40 hover:bg-muted/50 transition-colors cursor-pointer" data-testid="card-qbr-asr">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Network ASR</span>
                <Activity className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
              <p className={cn("text-2xl font-bold tabular-nums", asrText(s!.asr))}>
                {s!.asr}%
              </p>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", asrBar(s!.asr))} style={{ width: `${Math.min(s!.asr, 100)}%` }} />
              </div>
              <p className="text-[10px] text-muted-foreground">{s!.answeredCalls.toLocaleString()} / {s!.totalCalls.toLocaleString()} answered</p>
            </button>

            {/* ACD */}
            <button onClick={() => navigate('/analytics')} className="text-left bg-muted/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-primary/40 hover:bg-muted/50 transition-colors cursor-pointer" data-testid="card-qbr-acd">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avg ACD</span>
                <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {s!.acd > 0 ? `${s!.acd}s` : '—'}
              </p>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(s!.acd / 120 * 100, 100)}%` }} />
              </div>
              <p className="text-[10px] text-muted-foreground">average call duration (answered)</p>
            </button>

            {/* PDD */}
            <button onClick={() => navigate('/analytics')} className="text-left bg-muted/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-primary/40 hover:bg-muted/50 transition-colors cursor-pointer" data-testid="card-qbr-pdd">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avg PDD</span>
                <Timer className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
              <p className={cn("text-2xl font-bold tabular-nums",
                s!.pdd === 0 ? "text-muted-foreground"
                : s!.pdd <= 2000 ? "text-emerald-400"
                : s!.pdd <= 3500 ? "text-amber-400" : "text-red-400"
              )}>
                {s!.pdd > 0 ? `${(s!.pdd / 1000).toFixed(2)}s` : '—'}
              </p>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full",
                    s!.pdd <= 2000 ? "bg-emerald-500" : s!.pdd <= 3500 ? "bg-amber-500" : "bg-red-500"
                  )}
                  style={{ width: `${Math.max(0, 100 - (s!.pdd / 4000 * 100))}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">post-dial delay (lower is better)</p>
            </button>

            {/* Routes status */}
            <button onClick={() => navigate('/routing-manager?tab=connections')} className="text-left bg-muted/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-primary/40 hover:bg-muted/50 transition-colors cursor-pointer" data-testid="card-qbr-routes">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Routes</span>
                <Zap className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {s!.activeRoutes}
                {s!.degradedRoutes > 0 && (
                  <span className="text-sm font-normal text-red-400 ml-1.5">
                    {s!.degradedRoutes} alert{s!.degradedRoutes > 1 ? 's' : ''}
                  </span>
                )}
              </p>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", s!.degradedRoutes === 0 ? "bg-emerald-500" : "bg-amber-500")}
                  style={{ width: s!.activeRoutes > 0 ? `${Math.round((s!.activeRoutes - s!.degradedRoutes) / s!.activeRoutes * 100)}%` : '0%' }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">{s!.totalCalls.toLocaleString()} calls in window</p>
            </button>
          </div>

          {/* ── Alert banner ──────────────────────────────────────────────────── */}
          {s!.degradedRoutes > 0 && (
            <div className="flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5 text-sm text-amber-400" data-testid="banner-qbr-alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{s!.degradedRoutes}</strong> route{s!.degradedRoutes > 1 ? 's are' : ' is'} degraded or critical — check quality metrics below and consider route adjustments
              </span>
            </div>
          )}

          {/* ── Empty state ──────────────────────────────────────────────────── */}
          {data.vendors.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <div className="bg-muted/40 p-5 rounded-2xl border border-border/40">
                <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium">No CDR data in this window</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                No calls were recorded in the last {hours}h window. Expand the time window or wait for the CDR cache to populate.
              </p>
            </div>
          ) : (
            /* ── Route quality table ─────────────────────────────────────────── */
            <div className="border border-border/40 rounded-xl overflow-hidden">
              {/* Column headers */}
              <div className="hidden md:grid text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 px-4 py-2.5 gap-3 items-center"
                style={{ gridTemplateColumns: '28px 1fr 70px 90px 130px 72px 80px 120px 90px' }}>
                <span>#</span>
                <span>Vendor / Connection</span>
                <span>Proto</span>
                <span className="text-right">Calls</span>
                <span>ASR</span>
                <span className="text-right">ACD</span>
                <span className="text-right">PDD</span>
                <span>QBR Score</span>
                <span className="text-center">Status</span>
              </div>

              {/* Rows */}
              <div className="divide-y divide-border/30">
                {data.vendors.map((v, i) => (
                  <div
                    key={v.vendor}
                    data-testid={`row-qbr-${i}`}
                    className="hidden md:grid px-4 py-3 gap-3 items-center hover:bg-muted/20 transition-colors cursor-pointer"
                    style={{ gridTemplateColumns: '28px 1fr 70px 90px 130px 72px 80px 120px 90px' }}
                    onClick={() => navigate(`/lcr-analyser?vendor=${encodeURIComponent(v.vendor)}`)}
                  >
                    {/* Rank */}
                    <span className="text-xs text-muted-foreground tabular-nums font-mono">{i + 1}</span>

                    {/* Vendor + connection */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-qbr-vendor-${i}`}>{v.vendor}</p>
                      {v.connectionName && v.connectionName !== v.vendor && (
                        <p className="text-[10px] text-muted-foreground truncate">{v.connectionName}</p>
                      )}
                      {v.host && (
                        <p className="text-[10px] text-muted-foreground/60 truncate font-mono">{v.host}</p>
                      )}
                    </div>

                    {/* Protocol */}
                    <span className="text-xs text-muted-foreground uppercase">{v.protocol ?? '—'}</span>

                    {/* Calls */}
                    <div className="text-right">
                      <p className="text-xs tabular-nums font-medium">{v.totalCalls.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">{v.answeredCalls.toLocaleString()} ans</p>
                    </div>

                    {/* ASR bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className={cn("font-bold tabular-nums", asrText(v.asr))}>{v.asr}%</span>
                        <span className="text-muted-foreground/60">{v.answeredCalls}/{v.totalCalls}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", asrBar(v.asr))} style={{ width: `${Math.min(v.asr, 100)}%` }} />
                      </div>
                    </div>

                    {/* ACD */}
                    <div className="text-right">
                      <span className="text-xs tabular-nums">{v.acd > 0 ? `${v.acd}s` : '—'}</span>
                    </div>

                    {/* PDD */}
                    <div className="text-right">
                      <span className={cn("text-xs tabular-nums",
                        v.pdd === 0 ? "text-muted-foreground"
                        : v.pdd <= 2000 ? "text-emerald-400"
                        : v.pdd <= 3500 ? "text-amber-400" : "text-red-400"
                      )}>
                        {v.pdd > 0 ? `${v.pdd}ms` : '—'}
                      </span>
                    </div>

                    {/* QBR Score bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className={cn("font-bold tabular-nums", qbrStatusText(v.status))}>{v.qbrScore}</span>
                        <span className="text-muted-foreground/60">/100</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", qbrBar(v.qbrScore))} style={{ width: `${v.qbrScore}%` }} />
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="flex justify-center">
                      <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 capitalize", qbrStatusBg(v.status))}>
                        {v.status}
                      </Badge>
                    </div>
                  </div>
                ))}

                {/* Mobile card view */}
                {data.vendors.map((v, i) => (
                  <div
                    key={`m-${v.vendor}`}
                    className="md:hidden px-4 py-3 space-y-2 cursor-pointer hover:bg-muted/20 transition-colors"
                    data-testid={`card-qbr-mobile-${i}`}
                    onClick={() => navigate(`/lcr-analyser?vendor=${encodeURIComponent(v.vendor)}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-xs text-muted-foreground mr-1.5">#{i + 1}</span>
                        <span className="text-sm font-medium">{v.vendor}</span>
                        {v.host && <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">{v.host}</p>}
                      </div>
                      <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 capitalize shrink-0", qbrStatusBg(v.status))}>
                        {v.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className={cn("text-xs font-bold", asrText(v.asr))}>{v.asr}%</p>
                        <p className="text-[10px] text-muted-foreground">ASR</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold">{v.acd > 0 ? `${v.acd}s` : '—'}</p>
                        <p className="text-[10px] text-muted-foreground">ACD</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold">{v.pdd > 0 ? `${v.pdd}ms` : '—'}</p>
                        <p className="text-[10px] text-muted-foreground">PDD</p>
                      </div>
                      <div>
                        <p className={cn("text-xs font-bold", qbrStatusText(v.status))}>{v.qbrScore}</p>
                        <p className="text-[10px] text-muted-foreground">QBR</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Table footer */}
              <div className="bg-muted/20 px-4 py-2 border-t border-border/30 flex items-center justify-between flex-wrap gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {data.meta.cdrsAnalyzed.toLocaleString()} CDRs analysed · last {hours}h window
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Score = 40% ASR + 30% ACD + 30% PDD
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── On-Net Routing Viewer ──────────────────────────────────────────────────────

function OnNetTab() {
  const [search, setSearch]   = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data, isLoading } = useQuery<{ groups: RoutingGroup[] }>({
    queryKey: ["/api/routing-cache/routing-groups"],
  });
  const allGroups  = data?.groups ?? [];
  const onNetGroups = allGroups.filter(g => g.on_net);
  const groups = onNetGroups.filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/8 px-4 py-3 text-center">
          <p className="text-2xl font-bold text-cyan-400">{onNetGroups.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">On-Net Groups</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-muted/10 px-4 py-3 text-center">
          <p className="text-2xl font-bold">{onNetGroups.reduce((s, g) => s + g.members_count, 0)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Total Members</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-muted/10 px-4 py-3 text-center">
          <p className="text-2xl font-bold">{allGroups.length - onNetGroups.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Off-Net Groups</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-300">
        <Wifi className="h-4 w-4 mt-0.5 shrink-0 text-cyan-400" />
        <span>On-Net routing groups route traffic between known peers without traversing the PSTN — typically for direct inter-carrier interconnects and on-net call optimisation.</span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search on-net routing groups…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9"
          data-testid="input-search-onnet"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading from local cache…</span>
        </div>
      ) : onNetGroups.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Wifi className="h-10 w-10 opacity-20 mx-auto mb-3" />
          <p className="font-medium">No on-net routing groups found</p>
          <p className="text-sm mt-1 opacity-70">Sync the routing cache to refresh data from Sippy.</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No groups match your search.</div>
      ) : (
        <div className="space-y-1.5">
          {groups.map(rg => {
            const isExpanded = expandedId === rg.i_routing_group;
            return (
              <div key={rg.i_routing_group} className="rounded-xl border border-cyan-500/20 bg-card/60 overflow-hidden" data-testid={`onnet-rg-${rg.i_routing_group}`}>
                <button
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                  onClick={() => setExpandedId(isExpanded ? null : rg.i_routing_group)}
                  data-testid={`btn-expand-onnet-${rg.i_routing_group}`}
                >
                  <div className="h-9 w-9 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                    <Wifi className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">{rg.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">#{rg.i_routing_group}</span>
                      <Badge variant="outline" className="h-4 text-[10px] border-cyan-500/40 text-cyan-400 px-1">On-Net</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className={`text-xs font-medium ${policyColor(rg.policy)}`}>{policyLabel(rg.policy)}</span>
                      <span className="text-xs text-muted-foreground">{rg.members_count} member{rg.members_count !== 1 ? 's' : ''}</span>
                      {rg.media_relay && <span className="text-xs text-muted-foreground">{rg.media_relay}</span>}
                    </div>
                  </div>
                  <ChevronRight className={cn("h-4 w-4 text-muted-foreground/40 transition-transform duration-200", isExpanded && "rotate-90")} />
                </button>
                {isExpanded && (
                  <div className="border-t border-cyan-500/20 bg-muted/10 pb-1">
                    <div className="px-4 py-2 flex items-center gap-2 border-b border-border/20">
                      <Server className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">On-Net Members</span>
                    </div>
                    <div className="pt-2">
                      <RgMembersPanel groupId={rg.i_routing_group} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Routing Policy Simulator ───────────────────────────────────────────────────

function PolicySimTab() {
  const [cld, setCld]           = useState("");
  const [cli, setCli]           = useState("");
  const [selectedRgId, setSelectedRgId] = useState<string>("");
  const [simResult, setSimResult]       = useState<{ rg: RoutingGroup; members: RgMember[] } | null>(null);
  const [simLoading, setSimLoading]     = useState(false);

  const { data: rgData } = useQuery<{ groups: RoutingGroup[] }>({
    queryKey: ["/api/routing-cache/routing-groups"],
  });
  const groups = rgData?.groups ?? [];

  async function runSim() {
    const rgId = Number(selectedRgId);
    if (!cld.trim() || !rgId) return;
    setSimLoading(true);
    setSimResult(null);
    try {
      const res = await fetch(`/api/routing-cache/routing-groups/${rgId}/detail`);
      const detail: RgDetail = await res.json();
      const rg = groups.find(g => g.i_routing_group === rgId);
      if (rg && detail.ok) {
        setSimResult({ rg, members: detail.members });
      } else {
        setSimResult(null);
      }
    } catch { /* ignore */ } finally { setSimLoading(false); }
  }

  // Simulate routing decision based on policy
  function simulateWinner(members: RgMember[], policy: string | null): RgMember | null {
    const active = members.filter(m => !m.blocked);
    if (active.length === 0) return null;
    const p = policy ?? "";
    if (p.includes("least_cost")) {
      // Would need rate card data — show note instead
      return null;
    }
    if (p.includes("weight") || p.includes("random")) {
      // Weighted random — just show distribution
      return null;
    }
    // Priority / prefix,preference — lowest preference number wins
    const sorted = [...active].sort((a, b) => (a.preference ?? 99) - (b.preference ?? 99));
    return sorted[0] ?? null;
  }

  const winner = simResult ? simulateWinner(simResult.members, simResult.rg.policy) : null;
  const isLcr  = simResult?.rg.policy?.includes("least_cost");
  const isWeighted = simResult?.rg.policy?.includes("weight") || simResult?.rg.policy?.includes("random");
  const activeMems = (simResult?.members ?? []).filter(m => !m.blocked);
  const sortedMems = [...(simResult?.members ?? [])].sort((a, b) => (a.preference ?? 99) - (b.preference ?? 99));

  return (
    <div className="space-y-5">
      {/* Explainer */}
      <div className="flex items-start gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-sm text-violet-300">
        <Settings2 className="h-4 w-4 mt-0.5 shrink-0 text-violet-400" />
        <span>Simulates which connection a routing group would select for a given destination, based on its configured routing policy (priority, LCR, weighted). Uses cached routing data — no live calls are made.</span>
      </div>

      {/* Input form */}
      <div className="rounded-xl border border-border/50 bg-card/60 p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4 text-violet-400" />Simulation Parameters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">CLI (Caller ID)</label>
            <Input
              value={cli}
              onChange={e => setCli(e.target.value)}
              placeholder="e.g. 14155551234"
              data-testid="input-sim-cli"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">CLD (Destination) *</label>
            <Input
              value={cld}
              onChange={e => setCld(e.target.value)}
              placeholder="e.g. 447911123456"
              data-testid="input-sim-cld"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Routing Group *</label>
          <select
            className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={selectedRgId}
            onChange={e => { setSelectedRgId(e.target.value); setSimResult(null); }}
            data-testid="select-sim-rg"
          >
            <option value="">— Select routing group —</option>
            {groups.map(g => (
              <option key={g.i_routing_group} value={g.i_routing_group}>
                {g.name} ({policyLabel(g.policy)} · {g.members_count} members)
              </option>
            ))}
          </select>
        </div>
        <Button
          onClick={runSim}
          disabled={!cld.trim() || !selectedRgId || simLoading}
          data-testid="button-run-sim"
          className="w-full sm:w-auto"
        >
          {simLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
          Simulate Route
        </Button>
      </div>

      {/* Results */}
      {simResult && (
        <div className="space-y-4">
          {/* Policy banner */}
          <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 px-4 py-3">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold">{simResult.rg.name}</span>
              <span className="text-sm text-muted-foreground ml-2">— routing {cld}</span>
            </div>
            <Badge variant="outline" className={`text-xs ${policyColor(simResult.rg.policy)}`}>
              {policyLabel(simResult.rg.policy)}
            </Badge>
          </div>

          {/* Winner card */}
          {winner && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300">Predicted Winner — Preference {winner.preference}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div><span className="text-muted-foreground">Connection</span><div className="font-medium mt-0.5">{winner.connectionName ?? `#${winner.iConnection}`}</div></div>
                <div><span className="text-muted-foreground">Vendor</span><div className="font-medium mt-0.5">{winner.vendorName ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Destination Set</span><div className="font-medium mt-0.5 text-violet-400">{winner.destSetName ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Host</span><div className="font-mono text-[10px] mt-0.5">{winner.host ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Routes in DS</span><div className="font-medium mt-0.5">{winner.destSetRouteCount ?? "—"}</div></div>
              </div>
            </div>
          )}

          {/* LCR / weighted notice */}
          {isLcr && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>This routing group uses <strong>Least Cost Routing</strong>. The actual winner depends on rate card data at call time. The cascade below shows all candidates in preference order.</span>
            </div>
          )}
          {isWeighted && !isLcr && (
            <div className="flex items-start gap-2 rounded-xl border border-blue-500/20 bg-blue-500/8 px-4 py-3 text-sm text-blue-300">
              <Activity className="h-4 w-4 shrink-0 mt-0.5" />
              <span>This routing group uses <strong>Weighted Routing</strong>. Traffic is distributed probabilistically. All active members below are valid candidates.</span>
            </div>
          )}

          {/* Cascade waterfall */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Call Cascade — {activeMems.length} active / {simResult.members.length} total members
            </p>
            <div className="space-y-1.5">
              {sortedMems.map((m, idx) => {
                const isWinner = !m.blocked && winner && m.iConnection === winner.iConnection && m.preference === winner.preference;
                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm transition-colors",
                      m.blocked          && "opacity-40 border-border/30 bg-muted/10",
                      isWinner           && "border-emerald-500/40 bg-emerald-500/10",
                      !m.blocked && !isWinner && "border-border/40 bg-card/40"
                    )}
                    data-testid={`sim-member-${idx}`}
                  >
                    <div className={cn(
                      "h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                      isWinner     ? "bg-emerald-500/20 text-emerald-400"    :
                      m.blocked    ? "bg-muted/30 text-muted-foreground/40"  :
                                     "bg-muted/20 text-muted-foreground/60"
                    )}>
                      {m.blocked ? "✕" : (idx + 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{m.connectionName ?? `Connection #${m.iConnection}`}</span>
                      {m.vendorName && <span className="text-xs text-muted-foreground ml-2">{m.vendorName}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">Pref {m.preference ?? "—"}</div>
                    {m.destSetName && (
                      <div className="text-xs text-violet-400 font-medium shrink-0 hidden sm:block">{m.destSetName}</div>
                    )}
                    {isWinner && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
                    {m.blocked && <Badge variant="destructive" className="h-4 text-[9px] px-1.5 shrink-0">Blocked</Badge>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlaceholderTab({ title, description }: { title: string; description: string; icon?: typeof Construction }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="bg-muted/40 p-5 rounded-2xl border border-border/40">
        <Construction className="h-10 w-10 text-muted-foreground/50" />
      </div>
      <div>
        <p className="text-base font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
      </div>
      <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30 bg-amber-500/10">Coming Soon</Badge>
    </div>
  );
}

export default function RoutingManagerPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const rawSearch = useSearch();

  const tabFromUrl = (new URLSearchParams(rawSearch ?? "")).get("tab") as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(
    tabFromUrl && VALID_TABS.has(tabFromUrl) ? tabFromUrl : "routing-groups"
  );

  // Sync tab when URL changes (sidebar link clicked)
  useEffect(() => {
    const t = (new URLSearchParams(rawSearch ?? "")).get("tab") as TabId | null;
    if (t && VALID_TABS.has(t)) setActiveTab(t);
  }, [rawSearch]);

  const { data: meta, isLoading: metaLoading } = useQuery<CacheMeta>({
    queryKey: ["/api/routing-cache/status"],
    refetchInterval: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/routing-cache/sync"),
    onSuccess: async (res: any) => {
      const data = await res.json().catch(() => ({}));
      await qc.invalidateQueries({ queryKey: ["/api/routing-cache"] });
      toast({ title: "Sync complete", description: data.message ?? "Routing cache refreshed from Sippy." });
    },
    onError: (e: any) => {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          Routing Cache Manager
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Local snapshot of Sippy routing data — zero switch load for routing queries.
          Auto-synced every 15 minutes.
        </p>
      </div>

      {/* Status banner */}
      <CacheStatusBanner
        meta={meta}
        onSync={() => syncMutation.mutate()}
        syncing={syncMutation.isPending}
      />

      {/* How it works */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: RefreshCw,  label: "Auto-sync",    desc: "Every 15 min",              color: "text-cyan-400"    },
          { icon: Database,   label: "Local DB",      desc: "No switch query on reads",  color: "text-emerald-400" },
          { icon: ChevronRight,label: "Switch load",  desc: "Only on scheduled sync",    color: "text-amber-400"   },
        ].map(({ icon: Icon, label, desc, color }) => (
          <div key={label} className="flex items-start gap-3 p-3 rounded-xl border border-border/40 bg-card/40">
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
            <div>
              <p className="text-xs font-semibold">{label}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 w-fit">
        {TABS.map(t => {
          const count = t.countKey ? Number(meta?.[t.countKey] ?? 0) : 0;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === t.id
                  ? "bg-card text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
              {count > 0 && (
                <span className={`text-xs rounded-full px-1.5 py-0.5 font-mono ${
                  activeTab === t.id ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "routing-groups"   && <RoutingGroupsTab />}
      {activeTab === "destination-sets" && <DestinationSetsTab />}
      {activeTab === "connections"      && <ConnectionsTab />}
      {activeTab === "qbr"       && <QbrTab />}
      {activeTab === "on-net"    && <OnNetTab />}
      {activeTab === "policy-sim"&& <PolicySimTab />}
    </div>
  );
}
