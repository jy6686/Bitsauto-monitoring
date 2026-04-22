import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Shield, RefreshCw, Loader2, Plus, Trash2, AlertTriangle,
  Server, Network, CheckCircle2, XCircle, Info,
  ChevronRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NetworkService {
  iProtoTransport: number;
  listeners: { ipAddress: string; port: number }[];
}

interface AuthRule {
  iAuthentication: number;
  iProtocol?: number;
  remoteIp?: string;
  incomingCli?: string;
  incomingCld?: string;
  maxSessions?: number;
}

interface BalanceAccount {
  iAccount: number;
  username: string;
  balance: number;
  allowedIps: string[];
}

// ── Proto transport label map (common Sippy IDs) ──────────────────────────────
const PROTO_LABELS: Record<number, string> = {
  1:  "SIP / UDP",
  2:  "SIP / TCP",
  3:  "IAX2 / UDP",
  4:  "SIP / TLS",
  5:  "MGCP",
  6:  "H.323",
  7:  "SIP / WebSocket",
  8:  "SIP / Secure WebSocket",
};

function protoLabel(id: number): string {
  return PROTO_LABELS[id] ?? `Proto ${id}`;
}

// ── Protocol options for new auth rule ───────────────────────────────────────
const PROTOCOL_OPTS = [
  { value: "1", label: "SIP (1)" },
  { value: "3", label: "IAX2 (3)" },
  { value: "4", label: "PIN (4)" },
];

// ── Tab type ─────────────────────────────────────────────────────────────────
type Tab = "services" | "accounts";

// ── Section A: Network Services ───────────────────────────────────────────────

function NetworkServicesTab() {
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery<NetworkService[]>({
    queryKey: ["/api/sippy/network-services"],
    retry: 1,
  });

  const services = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Sippy listening interfaces — each row shows a protocol/transport and the IP addresses and ports the switch accepts traffic on.
          </p>
        </div>
        <Button
          data-testid="button-refresh-services"
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={cn("w-4 h-4 mr-1.5", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 py-10 justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Fetching network services from Sippy…</span>
        </div>
      )}

      {!isLoading && error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-rose-500/25 bg-rose-500/8 text-rose-300 text-sm">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          <span>Failed to load network services. Ensure Sippy is connected.</span>
        </div>
      )}

      {!isLoading && !error && services.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <Server className="w-8 h-8 opacity-20" />
          <p className="text-sm">No network services returned. Check your Sippy connection in Settings.</p>
        </div>
      )}

      {services.length > 0 && (
        <div className="space-y-3">
          {services.map((svc) => (
            <div
              key={svc.iProtoTransport}
              data-testid={`card-service-${svc.iProtoTransport}`}
              className="rounded-xl border border-border/50 bg-card p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-blue-400" />
                <span className="font-semibold text-sm">{protoLabel(svc.iProtoTransport)}</span>
                <span className="text-xs text-muted-foreground font-mono">ID={svc.iProtoTransport}</span>
                <span className={cn(
                  "ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold",
                  svc.listeners.length > 0
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                    : "bg-muted/30 text-muted-foreground border border-border/50"
                )}>
                  {svc.listeners.length > 0
                    ? <><CheckCircle2 className="w-3 h-3" /> {svc.listeners.length} listener{svc.listeners.length !== 1 ? "s" : ""}</>
                    : "No listeners"}
                </span>
              </div>

              {svc.listeners.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40 text-muted-foreground">
                        <th className="text-left py-1.5 pr-6 font-medium">IP Address</th>
                        <th className="text-left py-1.5 font-medium">Port</th>
                      </tr>
                    </thead>
                    <tbody>
                      {svc.listeners.map((l, i) => (
                        <tr key={i} className="border-b border-border/20 last:border-0">
                          <td className="py-1.5 pr-6 font-mono text-foreground">{l.ipAddress || <span className="text-muted-foreground italic">any (0.0.0.0)</span>}</td>
                          <td className="py-1.5 font-mono text-blue-400">{l.port}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/60 italic">This service has no active listener bindings.</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 text-amber-300 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>
          Network service listeners are managed at the switch level. Editing them via Sippy Admin → Network Services can affect call routing. Changes here are read-only in this view.
        </span>
      </div>
    </div>
  );
}

// ── Section B: Account IP Whitelist ──────────────────────────────────────────

function AddIPForm({
  iAccount,
  onDone,
}: {
  iAccount: number;
  onDone: () => void;
}) {
  const [ip,       setIp]       = useState("");
  const [protocol, setProtocol] = useState("1");
  const [maxSess,  setMaxSess]  = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const addMut = useMutation({
    mutationFn: (body: object) =>
      apiRequest("POST", `/api/sippy/accounts/${iAccount}/auth-rules`, body),
    onSuccess: () => {
      toast({ title: "IP added", description: `${ip} whitelisted on account ${iAccount}.` });
      qc.invalidateQueries({ queryKey: [`/api/sippy/accounts/${iAccount}/auth-rules`] });
      qc.invalidateQueries({ queryKey: ["/api/sippy/balance-monitor"] });
      setIp(""); setMaxSess("");
      onDone();
    },
    onError: (e: any) => {
      toast({ title: "Failed to add IP", description: e.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const handleAdd = () => {
    if (!ip.trim()) {
      toast({ title: "IP required", description: "Enter an IP address or CIDR range.", variant: "destructive" });
      return;
    }
    const body: Record<string, unknown> = {
      iProtocol: parseInt(protocol, 10),
      remoteIp:  ip.trim(),
    };
    if (maxSess) body.maxSessions = parseInt(maxSess, 10) || -1;
    addMut.mutate(body);
  };

  return (
    <div className="p-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 space-y-3">
      <p className="text-sm font-medium text-emerald-400 flex items-center gap-2">
        <Plus className="w-4 h-4" /> Add IP Whitelist Entry
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-1 space-y-1.5">
          <Label htmlFor="new-ip" className="text-xs">IP / CIDR *</Label>
          <Input
            id="new-ip"
            data-testid="input-new-ip"
            placeholder="e.g. 203.0.113.10"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Protocol</Label>
          <Select value={protocol} onValueChange={setProtocol}>
            <SelectTrigger data-testid="select-proto" className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROTOCOL_OPTS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="max-sess" className="text-xs">Max Sessions (blank = unlimited)</Label>
          <Input
            id="max-sess"
            data-testid="input-max-sessions"
            type="number"
            placeholder="e.g. 10"
            value={maxSess}
            onChange={(e) => setMaxSess(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          data-testid="button-add-ip"
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
          onClick={handleAdd}
          disabled={addMut.isPending}
        >
          {addMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
          Add Entry
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onDone} disabled={addMut.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AccountIPWhitelistTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: balanceData, isLoading: accountsLoading } = useQuery<{
    success: boolean;
    accounts: BalanceAccount[];
  }>({
    queryKey: ["/api/sippy/balance-monitor"],
    staleTime: 60_000,
  });

  const accounts = balanceData?.accounts ?? [];

  const { data: authRulesData, isLoading: rulesLoading, error: rulesError, refetch: refetchRules } = useQuery<{
    authRules: AuthRule[];
  }>({
    queryKey: [`/api/sippy/accounts/${selectedId}/auth-rules`],
    enabled: selectedId !== null,
    retry: 1,
  });

  const deleteMut = useMutation({
    mutationFn: (iAuthentication: number) =>
      apiRequest("DELETE", `/api/sippy/auth-rules/${iAuthentication}`),
    onSuccess: () => {
      toast({ title: "IP removed", description: "Auth rule deleted successfully." });
      qc.invalidateQueries({ queryKey: [`/api/sippy/accounts/${selectedId}/auth-rules`] });
      qc.invalidateQueries({ queryKey: ["/api/sippy/balance-monitor"] });
    },
    onError: (e: any) => {
      toast({ title: "Delete failed", description: e.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const selectedAccount = accounts.find(a => a.iAccount === selectedId);
  const authRules = (authRulesData?.authRules ?? []).filter(r => r.remoteIp);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select an account to view and manage its IP whitelist. Only rules with a Remote IP are shown here.
      </p>

      {/* Account selector */}
      {accountsLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading accounts…
        </div>
      ) : accounts.length === 0 ? (
        <div className="p-4 rounded-xl border border-border/50 text-muted-foreground text-sm text-center">
          No accounts found. Check your Sippy connection in Settings.
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Account</Label>
          <Select
            value={selectedId !== null ? String(selectedId) : ""}
            onValueChange={(v) => { setSelectedId(v ? parseInt(v, 10) : null); setShowAddForm(false); }}
          >
            <SelectTrigger data-testid="select-account" className="max-w-xs">
              <SelectValue placeholder="Select an account…" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map(a => (
                <SelectItem key={a.iAccount} value={String(a.iAccount)}>
                  {a.username} <span className="text-muted-foreground text-[11px] ml-1">(iAccount={a.iAccount})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Auth rules for selected account */}
      {selectedId !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              {selectedAccount?.username} — IP Whitelist
            </h3>
            <div className="flex gap-2">
              <Button
                data-testid="button-refresh-rules"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => refetchRules()}
                disabled={rulesLoading}
              >
                <RefreshCw className={cn("w-3 h-3 mr-1", rulesLoading && "animate-spin")} />
                Refresh
              </Button>
              {!showAddForm && (
                <Button
                  data-testid="button-show-add-ip"
                  size="sm"
                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus className="w-3 h-3 mr-1" /> Add IP
                </Button>
              )}
            </div>
          </div>

          {showAddForm && (
            <AddIPForm iAccount={selectedId} onDone={() => setShowAddForm(false)} />
          )}

          {rulesLoading && (
            <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading auth rules…
            </div>
          )}

          {!rulesLoading && rulesError && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-rose-500/25 bg-rose-500/8 text-rose-300 text-sm">
              <XCircle className="w-4 h-4 flex-shrink-0" />
              Failed to load auth rules for this account.
            </div>
          )}

          {!rulesLoading && !rulesError && authRules.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-border/40 bg-muted/10 text-muted-foreground">
              <Shield className="w-8 h-8 opacity-20" />
              <p className="text-sm">No IP-based auth rules found for this account.</p>
              <p className="text-xs opacity-60">This account may be authenticated by username/password only.</p>
            </div>
          )}

          {!rulesLoading && authRules.length > 0 && (
            <div className="rounded-xl border border-border/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border/50">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Remote IP</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Protocol</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Max Sessions</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rule ID</th>
                    <th className="px-4 py-2.5 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {authRules.map((rule, i) => (
                    <tr
                      key={rule.iAuthentication}
                      data-testid={`row-auth-rule-${rule.iAuthentication}`}
                      className={cn(
                        "border-b border-border/30 last:border-0",
                        i % 2 === 0 ? "bg-card" : "bg-muted/10"
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-blue-300">{rule.remoteIp}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">
                        {rule.iProtocol ? (PROTO_LABELS[rule.iProtocol] ?? `Protocol ${rule.iProtocol}`) : "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {rule.maxSessions === undefined ? "—" : rule.maxSessions === -1 || rule.maxSessions === 0 ? "Unlimited" : rule.maxSessions}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground/60">{rule.iAuthentication}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          data-testid={`button-delete-rule-${rule.iAuthentication}`}
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => deleteMut.mutate(rule.iAuthentication)}
                          disabled={deleteMut.isPending}
                        >
                          {deleteMut.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/8 border border-blue-500/20 text-blue-300 text-xs">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              Adding an IP here creates a new SIP auth rule in Sippy for this account.
              Deleting a rule removes IP-based authentication — the account may still work if it has username/password auth.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FirewallPage() {
  const [tab, setTab] = useState<Tab>("services");

  const tabs: { key: Tab; label: string; icon: typeof Shield }[] = [
    { key: "services", label: "Network Services", icon: Server },
    { key: "accounts", label: "Account IP Whitelist", icon: Shield },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-emerald-400" />
          <h2 className="text-2xl font-bold tracking-tight">Firewall Manager</h2>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          View Sippy network service listeners and manage account-level IP whitelists.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/60 gap-1">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              data-testid={`tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t.key
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === "services" && <NetworkServicesTab />}
        {tab === "accounts" && <AccountIPWhitelistTab />}
      </div>
    </div>
  );
}
