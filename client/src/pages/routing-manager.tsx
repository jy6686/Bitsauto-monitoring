import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Route, RefreshCw, Database, Server, Network, CheckCircle2,
  AlertCircle, Clock, Layers, Wifi, ChevronRight, Search, Filter,
  Loader2, GitBranch,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
          {groups.map(rg => (
            <div
              key={rg.i_routing_group}
              data-testid={`rg-row-${rg.i_routing_group}`}
              className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border/50 bg-card/60 hover:bg-card transition-colors"
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
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold">{rg.members_count}</div>
                <div className="text-xs text-muted-foreground">members</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Destination Sets Tab ───────────────────────────────────────────────────────

function DestinationSetsTab() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery<{ sets: DestinationSet[] }>({
    queryKey: ["/api/routing-cache/destination-sets"],
  });
  const sets = (data?.sets ?? []).filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

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
          {sets.map(ds => (
            <div
              key={ds.i_destination_set}
              data-testid={`ds-row-${ds.i_destination_set}`}
              className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border/50 bg-card/60 hover:bg-card transition-colors"
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
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold">{ds.route_count}</div>
                <div className="text-xs text-muted-foreground">routes</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Connections Tab ────────────────────────────────────────────────────────────

function ConnectionsTab() {
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
      <div className="flex gap-2">
        <div className="relative flex-1">
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
      </div>

      {isLoading ? (
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
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

type TabId = "routing-groups" | "destination-sets" | "connections";

const TABS: { id: TabId; label: string; icon: typeof Route; countKey: keyof CacheMeta }[] = [
  { id: "routing-groups",  label: "Routing Groups",   icon: GitBranch, countKey: "rg_count"   },
  { id: "destination-sets",label: "Destination Sets", icon: Layers,    countKey: "ds_count"   },
  { id: "connections",     label: "Connections",      icon: Wifi,      countKey: "conn_count" },
];

export default function RoutingManagerPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("routing-groups");

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
          const count = meta?.[t.countKey] ?? 0;
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
    </div>
  );
}
