import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import {
  Key, Plus, Trash2, Copy, CheckCircle2, Clock, ShieldCheck,
  ExternalLink, RefreshCw, Eye, EyeOff, AlertTriangle,
} from "lucide-react";

const PERMISSIONS = [
  { id: "live-calls",  label: "Live Calls",          desc: "GET /ext/api/live-calls"     },
  { id: "asr-acd",     label: "ASR / ACD Stats",     desc: "GET /ext/api/asr-acd"        },
  { id: "balance",     label: "Vendor Balance",       desc: "GET /ext/api/balance/:vendor"},
] as const;

type ApiKey = {
  id: number;
  name: string;
  keyPrefix: string;
  permissions: string[];
  active: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

function fmtDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ApiKeysPage() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPerms, setNewKeyPerms] = useState<string[]>(["live-calls", "asr-acd", "balance"]);
  const [createdKey, setCreatedKey]   = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCreatedKey, setShowCreatedKey] = useState(false);

  const { data: keys = [], isLoading, refetch } = useQuery<ApiKey[]>({
    queryKey: ["/api/keys"],
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; permissions: string[] }) =>
      apiRequest("POST", "/api/keys", body).then(r => r.json()),
    onSuccess: (data: ApiKey & { rawKey: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/keys"] });
      setCreatedKey(data.rawKey);
      setShowCreate(false);
      setNewKeyName("");
      setNewKeyPerms(["live-calls", "asr-acd", "balance"]);
      toast({ title: "API key created", description: "Save your key now — it will not be shown again." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/keys/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/keys"] });
      toast({ title: "Key revoked", description: "The API key has been deactivated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const copyKey = () => {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const togglePerm = (id: string) => {
    setNewKeyPerms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const activeKeys  = keys.filter(k => k.active);
  const revokedKeys = keys.filter(k => !k.active);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Key className="w-6 h-6 text-amber-400" />
            API Key Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate keys to allow external systems to query VoIP Watcher data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            data-testid="button-refresh-keys"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            data-testid="button-create-key"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New API Key
          </Button>
        </div>
      </div>

      {/* Newly created key banner */}
      {createdKey && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <AlertDescription>
            <p className="font-semibold text-amber-400 mb-2">Save your API key — it will not be shown again!</p>
            <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 font-mono text-sm">
              <span className="flex-1 truncate select-all" data-testid="text-created-key">
                {showCreatedKey ? createdKey : `${createdKey.slice(0, 20)}${"•".repeat(32)}`}
              </span>
              <button
                onClick={() => setShowCreatedKey(v => !v)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={showCreatedKey ? "Hide key" : "Show key"}
              >
                {showCreatedKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={copyKey}
                className="text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-copy-key"
              >
                {copied
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  : <Copy className="w-4 h-4" />
                }
              </button>
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground mt-2 underline"
              onClick={() => setCreatedKey(null)}
            >
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* External API reference */}
      <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ExternalLink className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">External API Endpoints</h2>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Bearer Auth</span>
        </div>
        <p className="text-xs text-muted-foreground">Pass your key in the <code className="text-foreground">Authorization: Bearer &lt;key&gt;</code> header.</p>
        <div className="space-y-2">
          {[
            { method: "GET", path: "/ext/api/live-calls",        desc: "Current active calls list"       },
            { method: "GET", path: "/ext/api/asr-acd",           desc: "ASR, ACD, active call count"     },
            { method: "GET", path: "/ext/api/balance/:vendor",   desc: "Vendor balance by name"           },
          ].map(ep => (
            <div key={ep.path} className="flex items-center gap-3 text-xs font-mono">
              <span className="text-emerald-400 font-bold w-8 text-right">{ep.method}</span>
              <code className="text-foreground bg-muted px-2 py-0.5 rounded">{ep.path}</code>
              <span className="text-muted-foreground font-sans">{ep.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Active keys */}
      <div className="space-y-3">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Active Keys
          {activeKeys.length > 0 && (
            <Badge variant="secondary" className="text-xs">{activeKeys.length}</Badge>
          )}
        </h2>
        {isLoading ? (
          <div className="text-center text-muted-foreground py-8">Loading…</div>
        ) : activeKeys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 bg-card/20 py-10 text-center">
            <Key className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeKeys.map(key => (
              <div
                key={key.id}
                className="rounded-xl border border-border/50 bg-card/40 px-5 py-4 flex items-center gap-4"
                data-testid={`row-key-${key.id}`}
              >
                <Key className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm" data-testid={`text-key-name-${key.id}`}>{key.name}</span>
                    <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">{key.keyPrefix}••••</code>
                    {key.permissions.map(p => (
                      <Badge key={p} variant="outline" className="text-[10px] py-0">{p}</Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Created {fmtDate(key.createdAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Last used: {fmtDate(key.lastUsedAt)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10 shrink-0"
                  onClick={() => revokeMutation.mutate(key.id)}
                  disabled={revokeMutation.isPending}
                  data-testid={`button-revoke-key-${key.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Revoked keys (collapsed) */}
      {revokedKeys.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Revoked Keys ({revokedKeys.length})
          </h2>
          <div className="space-y-1">
            {revokedKeys.map(key => (
              <div
                key={key.id}
                className="rounded-xl border border-border/30 bg-card/20 px-5 py-3 flex items-center gap-4 opacity-50"
              >
                <Key className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-muted-foreground">{key.name}</span>
                    <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">{key.keyPrefix}••••</code>
                    <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">revoked</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Revoked · Created {fmtDate(key.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create key dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              Create New API Key
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                placeholder="e.g. Billing System, Grafana, CRM"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                data-testid="input-key-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="space-y-2 rounded-lg border border-border/50 p-3">
                {PERMISSIONS.map(perm => (
                  <div key={perm.id} className="flex items-start gap-3">
                    <Checkbox
                      id={`perm-${perm.id}`}
                      checked={newKeyPerms.includes(perm.id)}
                      onCheckedChange={() => togglePerm(perm.id)}
                      data-testid={`checkbox-perm-${perm.id}`}
                    />
                    <div>
                      <Label htmlFor={`perm-${perm.id}`} className="text-sm font-medium cursor-pointer">{perm.label}</Label>
                      <p className="text-[10px] text-muted-foreground font-mono">{perm.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ name: newKeyName, permissions: newKeyPerms })}
              disabled={!newKeyName.trim() || createMutation.isPending}
              data-testid="button-confirm-create-key"
            >
              {createMutation.isPending ? "Creating…" : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
