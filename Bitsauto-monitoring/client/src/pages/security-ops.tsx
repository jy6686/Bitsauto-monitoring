import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Shield, Monitor, Globe, FileText, RefreshCw,
  Trash2, Plus, Power, PowerOff, ShieldCheck,
  ShieldOff, Clock, Laptop, CheckCircle2,
  AlertTriangle, User, XCircle,
} from "lucide-react";

type Tab = "sessions" | "ip" | "audit";

const SEVERITY_COLOR: Record<string, string> = {
  info:     "text-blue-400 bg-blue-500/10 border-blue-500/20",
  warning:  "text-amber-400 bg-amber-500/10 border-amber-500/20",
  critical: "text-rose-400 bg-rose-500/10 border-rose-500/20",
};

const CATEGORY_COLOR: Record<string, string> = {
  user:      "text-violet-400",
  system:    "text-blue-400",
  sippy:     "text-cyan-400",
  fraud:     "text-rose-400",
  financial: "text-emerald-400",
  security:  "text-amber-400",
};

function timeAgo(d: string | Date) {
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ── Sessions Tab ──────────────────────────────────────────────────────────────
function SessionsTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: sessions = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/security/sessions"],
    refetchInterval: 30_000,
  });

  const { data: stats } = useQuery<{ total: number; active5m: number; active1h: number }>({
    queryKey: ["/api/security/sessions/stats"],
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => apiRequest("DELETE", `/api/security/sessions/${encodeURIComponent(sessionId)}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/security/sessions"] }); toast({ title: "Session revoked" }); },
  });

  const revokeAllMutation = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/security/sessions/user/${userId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/security/sessions"] }); toast({ title: "All sessions revoked" }); },
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Active", val: stats?.total ?? 0, color: "text-foreground", bg: "bg-muted/20 border-border/30" },
          { label: "Active (5 min)", val: stats?.active5m ?? 0, color: "text-emerald-400", bg: "bg-emerald-500/5 border-emerald-500/20" },
          { label: "Active (1 hour)", val: stats?.active1h ?? 0, color: "text-blue-400", bg: "bg-blue-500/5 border-blue-500/20" },
        ].map(s => (
          <div key={s.label} className={cn("rounded-xl border p-4 text-center", s.bg)}>
            <div className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Session list */}
      <div className="rounded-xl border border-border/40 bg-card/20 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
          <span className="text-sm font-semibold">Active Sessions</span>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs h-7">
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
        <div className="divide-y divide-border/10">
          {sessions.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No active sessions</div>
          )}
          {sessions.map((s: any) => {
            const isOwn = s.userId === (user as any)?.id;
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3" data-testid={`session-row-${s.id}`}>
                <div className="p-1.5 rounded-lg bg-muted/20">
                  <Laptop className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <User className="h-3 w-3 text-muted-foreground/60" />
                    <span className="truncate">{s.userId}</span>
                    {isOwn && <Badge className="text-[9px] px-1.5 py-0 bg-violet-500/20 text-violet-400 border-violet-500/30">You</Badge>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground/60">
                    <span className="flex items-center gap-1">
                      <Globe className="h-2.5 w-2.5" /> {s.ipAddress ?? "Unknown IP"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" /> Active {timeAgo(s.lastActivity)}
                    </span>
                    <span>Created {timeAgo(s.createdAt)}</span>
                  </div>
                </div>
                {!isOwn && (
                  <button
                    onClick={() => revokeMutation.mutate(s.sessionId)}
                    disabled={revokeMutation.isPending}
                    className="text-rose-400 hover:text-rose-300 text-xs px-2 py-1 rounded-md hover:bg-rose-500/10 transition-colors flex items-center gap-1"
                    data-testid={`button-revoke-session-${s.id}`}
                  >
                    <XCircle className="h-3.5 w-3.5" /> Revoke
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── IP Restrictions Tab ───────────────────────────────────────────────────────
function IpRestrictionsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [newCidr, setNewCidr] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newScope, setNewScope] = useState("global");
  const [newScopeValue, setNewScopeValue] = useState("");

  const { data: rules = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/security/ip-restrictions"],
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/security/ip-restrictions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/security/ip-restrictions"] });
      setNewCidr(""); setNewDesc(""); setNewScopeValue("");
      toast({ title: "IP restriction added" });
    },
    onError: () => toast({ title: "Failed to add restriction", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/security/ip-restrictions/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/security/ip-restrictions"] }); toast({ title: "Restriction removed" }); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/security/ip-restrictions/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/security/ip-restrictions"] }),
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-sm">
        <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="text-muted-foreground">
          <span className="font-medium text-amber-400">Global rules</span> restrict ALL access to specified IPs.
          {" "}<span className="font-medium text-amber-400">Role/User rules</span> apply only to specific roles or users.
          Adding your first global rule immediately enforces the allowlist — ensure your own IP is included.
        </div>
      </div>

      {/* Add form */}
      <div className="rounded-xl border border-border/40 bg-card/20 p-4 space-y-3">
        <div className="text-sm font-semibold">Add IP Restriction</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">CIDR / IP</label>
            <Input value={newCidr} onChange={e => setNewCidr(e.target.value)} placeholder="192.168.1.0/24" data-testid="input-ip-cidr" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Scope</label>
            <select
              value={newScope}
              onChange={e => setNewScope(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              data-testid="select-ip-scope"
            >
              <option value="global">Global</option>
              <option value="role">By Role</option>
            </select>
          </div>
        </div>
        {newScope === "role" && (
          <Input value={newScopeValue} onChange={e => setNewScopeValue(e.target.value)} placeholder="Role name (e.g. admin)" data-testid="input-scope-value" />
        )}
        <Input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)" data-testid="input-ip-description" />
        <Button
          onClick={() => addMutation.mutate({ cidr: newCidr, scope: newScope, scopeValue: newScopeValue || null, description: newDesc || null })}
          disabled={addMutation.isPending || !newCidr.trim()}
          className="gap-1.5"
          data-testid="button-add-ip-restriction"
        >
          <Plus className="h-4 w-4" /> Add Rule
        </Button>
      </div>

      {/* Rules list */}
      <div className="rounded-xl border border-border/40 bg-card/20 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/20 text-sm font-semibold">Active Rules ({rules.length})</div>
        <div className="divide-y divide-border/10">
          {rules.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No IP restrictions configured — all IPs allowed</div>
          )}
          {rules.map((r: any) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3" data-testid={`ip-rule-${r.id}`}>
              <Globe className={cn("h-4 w-4", r.isActive ? "text-emerald-400" : "text-muted-foreground/30")} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm font-mono font-medium">{r.cidr}
                  <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4 normal-case font-sans",
                    r.scope === "global" ? "text-violet-400 border-violet-500/30" : "text-blue-400 border-blue-500/30"
                  )}>
                    {r.scope}{r.scopeValue ? `:${r.scopeValue}` : ""}
                  </Badge>
                  {!r.isActive && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground/50">Disabled</Badge>}
                </div>
                {r.description && <div className="text-xs text-muted-foreground/60 mt-0.5">{r.description}</div>}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                  className={cn("p-1.5 rounded-md transition-colors", r.isActive ? "text-emerald-400 hover:bg-emerald-500/10" : "text-muted-foreground/40 hover:bg-white/[0.05]")}
                  title={r.isActive ? "Disable" : "Enable"}
                  data-testid={`button-toggle-ip-${r.id}`}
                >
                  {r.isActive ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => deleteMutation.mutate(r.id)}
                  className="p-1.5 rounded-md text-rose-400/60 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  data-testid={`button-delete-ip-${r.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Audit Log Tab ─────────────────────────────────────────────────────────────
function AuditLogTab() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");

  const { data, isLoading } = useQuery<{ events: any[]; total: number }>({
    queryKey: ["/api/audit-log", search, category, severity],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (category) p.set("category", category);
      if (severity) p.set("severity", severity);
      p.set("limit", "100");
      const res = await fetch(`/api/audit-log?${p}`, { credentials: "include" });
      return res.json();
    },
  });

  const events = data?.events ?? [];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Search actions, actors…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
          data-testid="input-audit-search"
        />
        <select value={category} onChange={e => setCategory(e.target.value)} className="h-8 px-2.5 rounded-md border border-input bg-background text-sm" data-testid="select-audit-category">
          <option value="">All categories</option>
          <option value="user">User</option>
          <option value="system">System</option>
          <option value="sippy">Sippy</option>
          <option value="fraud">Fraud</option>
          <option value="financial">Financial</option>
          <option value="security">Security</option>
        </select>
        <select value={severity} onChange={e => setSeverity(e.target.value)} className="h-8 px-2.5 rounded-md border border-input bg-background text-sm" data-testid="select-audit-severity">
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="rounded-xl border border-border/40 bg-card/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/20 flex items-center justify-between">
            <span className="text-sm font-semibold">Audit Log</span>
            <span className="text-xs text-muted-foreground">{data?.total ?? 0} total events</span>
          </div>
          <div className="divide-y divide-border/10 max-h-[600px] overflow-y-auto">
            {events.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">No audit events found</div>
            )}
            {events.map((e: any) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-3" data-testid={`audit-event-${e.id}`}>
                <div className={cn("flex-shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                  SEVERITY_COLOR[e.severity] ?? SEVERITY_COLOR.info
                )}>
                  {e.severity?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[11px] font-semibold uppercase tracking-wider", CATEGORY_COLOR[e.category] ?? "text-muted-foreground")}>
                      {e.category}
                    </span>
                    <span className="text-sm text-foreground/90 font-medium truncate">{e.action}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground/60">
                    {e.actor && <span>by {e.actor}</span>}
                    {e.targetName && <><span>·</span><span>{e.targetName}</span></>}
                    {e.ip && <><span>·</span><span className="font-mono">{e.ip}</span></>}
                    <span>·</span>
                    <span>{timeAgo(e.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SecurityOpsPage() {
  const { role } = useAuth();
  const [tab, setTab] = useState<Tab>("sessions");

  if (role !== "admin" && role !== "super_admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center">
        <ShieldOff className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "sessions",  label: "Sessions",        icon: Monitor },
    { key: "ip",        label: "IP Restrictions",  icon: Globe   },
    { key: "audit",     label: "Audit Log",         icon: FileText },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Shield className="h-6 w-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Security Operations</h1>
            <p className="text-sm text-muted-foreground">Session governance, IP restrictions, and immutable audit trail</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted/20 rounded-xl border border-border/30 w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
              tab === t.key
                ? "bg-background text-foreground shadow-sm border border-border/40"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid={`tab-security-${t.key}`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "sessions"  && <SessionsTab />}
      {tab === "ip"        && <IpRestrictionsTab />}
      {tab === "audit"     && <AuditLogTab />}
    </div>
  );
}
