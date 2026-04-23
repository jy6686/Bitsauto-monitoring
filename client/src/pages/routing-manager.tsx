import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Route, RefreshCw, Database, Server, Network, CheckCircle2,
  AlertCircle, Clock, Layers, Wifi, ChevronRight, Search, Filter,
  Loader2, GitBranch, BarChart3, Eye, Settings2, Construction,
  ArrowRight, Activity, Timer, AlertTriangle, Zap,
  List, Grid3X3, ShieldAlert, XCircle, Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
  const { data, isLoading } = useQuery<RgDetail>({
    queryKey: ["/api/routing-cache/routing-groups", groupId, "detail"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 px-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading members from Sippy…
      </div>
    );
  }

  const members = data?.members ?? [];
  if (!data?.ok || members.length === 0) {
    return (
      <div className="py-3 px-4 text-xs text-muted-foreground/60 italic">
        {!data?.ok
          ? `Failed to load: ${data?.message ?? "Sippy unavailable"}`
          : "No members configured in this routing group."}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-border/40 rounded-lg mx-4 mb-3 bg-background/40">
      <table className="w-full text-xs min-w-[680px]">
        <thead>
          <tr className="bg-muted/50 border-b border-border/30">
            {["Pref", "Weight", "Vendor / Connection", "Host", "Destination Set", "Routes", "Status"].map(h => (
              <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => (
            <tr key={i} className={cn("border-t border-border/20 hover:bg-muted/20 transition-colors", m.blocked && "opacity-50")}>
              <td className="px-3 py-2 font-mono font-bold text-amber-400">{m.preference ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{m.weight ?? "—"}</td>
              <td className="px-3 py-2">
                <div className="font-medium">{m.connectionName ?? `Connection #${m.iConnection}`}</div>
                {m.vendorName && <div className="text-[10px] text-muted-foreground/70">{m.vendorName}</div>}
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground/70">{m.host ?? "—"}</td>
              <td className="px-3 py-2">
                {m.destSetName
                  ? <span className="text-violet-400 font-medium">{m.destSetName}</span>
                  : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className="px-3 py-2 font-mono text-muted-foreground/70">{m.destSetRouteCount ?? "—"}</td>
              <td className="px-3 py-2">
                {m.blocked
                  ? <Badge variant="destructive" className="h-4 text-[9px] px-1.5">Blocked</Badge>
                  : <span className="text-[10px] text-emerald-400 font-medium">Active</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── DsRoutesPanel ──────────────────────────────────────────────────────────────

function DsRoutesPanel({ dsId, onRunLcr }: { dsId: number; onRunLcr: (prefix: string) => void }) {
  const { data, isLoading } = useQuery<DsRoutesData>({
    queryKey: ["/api/sippy/destination-sets", dsId, "routes"],
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
  if (!data?.success || routes.length === 0) {
    return (
      <div className="py-3 px-4 text-xs text-muted-foreground/60 italic">
        {!data?.success
          ? `Failed to load: ${data?.message ?? "Sippy unavailable"}`
          : "No routes in this destination set."}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-border/40 rounded-lg mx-4 mb-3 bg-background/40">
      <table className="w-full text-xs min-w-[580px]">
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
                {!r.forbidden && (
                  <button
                    data-testid={`btn-lcr-${r.prefix}`}
                    onClick={() => onRunLcr(r.prefix)}
                    className="text-[10px] font-semibold text-primary hover:text-primary/70 transition-colors flex items-center gap-0.5"
                  >
                    Run LCR <ArrowRight className="h-2.5 w-2.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function RoutingGroupsTab() {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data, isLoading } = useQuery<{ groups: RoutingGroup[] }>({
    queryKey: ["/api/routing-cache/routing-groups"],
  });
  const groups = (data?.groups ?? []).filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search routing groups…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9"
          data-testid="input-search-rg"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading from local cache…</span>
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <GitBranch className="h-8 w-8 opacity-30 mx-auto mb-2" />
          <p className="text-sm">{search ? "No groups match your search" : "No routing groups cached yet — click Sync Now"}</p>
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
                <button
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
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
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-semibold">{rg.members_count}</div>
                      <div className="text-xs text-muted-foreground">members</div>
                    </div>
                    <ChevronRight className={cn("h-4 w-4 text-muted-foreground/40 transition-transform duration-200", isExpanded && "rotate-90")} />
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-border/40 bg-muted/10 pb-1">
                    <div className="px-4 py-2 flex items-center gap-2 border-b border-border/20">
                      <Server className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Routing Group Members
                      </span>
                      <span className="text-[10px] text-muted-foreground/40 ml-1">live from Sippy + cache enrichment</span>
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

// ── Destination Sets Tab ───────────────────────────────────────────────────────

function DestinationSetsTab() {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<{ sets: DestinationSet[] }>({
    queryKey: ["/api/routing-cache/destination-sets"],
  });
  const sets = (data?.sets ?? []).filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleRunLcr = (prefix: string) => {
    navigate(`/lcr-analyser?prefix=${encodeURIComponent(prefix)}`);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search destination sets…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9"
          data-testid="input-search-ds"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading from local cache…</span>
        </div>
      ) : sets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Layers className="h-8 w-8 opacity-30 mx-auto mb-2" />
          <p className="text-sm">{search ? "No sets match your search" : "No destination sets cached yet"}</p>
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
                <button
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
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
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-semibold">{ds.route_count}</div>
                      <div className="text-xs text-muted-foreground">routes</div>
                    </div>
                    <ChevronRight className={cn("h-4 w-4 text-muted-foreground/40 transition-transform duration-200", isExpanded && "rotate-90")} />
                  </div>
                </button>
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

function ConnectionsTab() {
  const [viewMode, setViewMode] = useState<'list' | 'coverage'>('list');
  const [search, setSearch] = useState("");
  const [showBlocked, setShowBlocked] = useState(true);
  const { data, isLoading } = useQuery<{ connections: Connection[] }>({
    queryKey: ["/api/routing-cache/connections"],
  });
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
          <p className="text-sm">{search ? "No connections match your search" : "No connections cached yet"}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(byVendor).map(([vendor, conns]) => (
            <div key={vendor} className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{vendor}</span>
                <span className="text-xs text-muted-foreground/50">({conns.length})</span>
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
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
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
            <div className="bg-muted/30 border border-border/40 rounded-xl p-4 space-y-2" data-testid="card-qbr-asr">
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
            </div>

            {/* ACD */}
            <div className="bg-muted/30 border border-border/40 rounded-xl p-4 space-y-2" data-testid="card-qbr-acd">
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
            </div>

            {/* PDD */}
            <div className="bg-muted/30 border border-border/40 rounded-xl p-4 space-y-2" data-testid="card-qbr-pdd">
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
            </div>

            {/* Routes status */}
            <div className="bg-muted/30 border border-border/40 rounded-xl p-4 space-y-2" data-testid="card-qbr-routes">
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
            </div>
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
                    className="hidden md:grid px-4 py-3 gap-3 items-center hover:bg-muted/20 transition-colors"
                    style={{ gridTemplateColumns: '28px 1fr 70px 90px 130px 72px 80px 120px 90px' }}
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
                    className="md:hidden px-4 py-3 space-y-2"
                    data-testid={`card-qbr-mobile-${i}`}
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
      {activeTab === "on-net"    && <PlaceholderTab title="On-Net Routing Viewer" description="Visualise all on-net routing groups and their member connections, overlaid on a live traffic heatmap." />}
      {activeTab === "policy-sim"&& <PlaceholderTab title="Routing Policy Simulator" description="Simulate LCR, prefix-priority, and weighted routing decisions against a test call leg before committing changes to the switch." />}
    </div>
  );
}
