import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Phone, Plus, Pencil, Trash2, RefreshCw, Search, Loader2,
  ArrowRightLeft, Link2, AlertTriangle, CheckCircle2, X,
  Filter, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DID {
  iDid: number;
  did: string;
  didRangeEnd: string | null;
  incomingDid: string | null;
  translationRule: string | null;
  cldTranslationRule: string | null;
  cliTranslationRule: string | null;
  description: string | null;
  iAccount: number | null;
  iVendor: number | null;
  iConnection: number | null;
  iDidDelegation: number | null;
  delegatedTo: number | null;
}

interface DIDListResponse {
  success: boolean;
  dids: DID[];
  error?: string;
}

interface AccountOption { iAccount: number; username: string; }

const EMPTY_FORM = {
  did: "", incomingDid: "", description: "",
  iAccount: "", translationRule: "", cldTranslationRule: "", cliTranslationRule: "",
};

function DIDFormModal({
  open, onClose, editing, accounts,
}: {
  open: boolean;
  onClose: () => void;
  editing: DID | null;
  accounts: AccountOption[];
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...(editing ? {
    did: editing.did,
    incomingDid: editing.incomingDid ?? "",
    description: editing.description ?? "",
    iAccount: editing.iAccount ? String(editing.iAccount) : "",
    translationRule: editing.translationRule ?? "",
    cldTranslationRule: editing.cldTranslationRule ?? "",
    cliTranslationRule: editing.cliTranslationRule ?? "",
  } : {}) });

  const { toast } = useToast();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/sippy/dids", body),
    onSuccess: () => { toast({ title: "DID added" }); qc.invalidateQueries({ queryKey: ["/api/sippy/dids"] }); onClose(); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (body: any) => apiRequest("PATCH", `/api/sippy/dids/${editing!.iDid}`, body),
    onSuccess: () => { toast({ title: "DID updated" }); qc.invalidateQueries({ queryKey: ["/api/sippy/dids"] }); onClose(); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const isPending = createMut.isPending || updateMut.isPending;

  const handleSubmit = () => {
    if (!form.did.trim()) return toast({ title: "DID number required", variant: "destructive" });
    if (!editing && !form.incomingDid.trim()) return toast({ title: "Incoming DID required", variant: "destructive" });
    const body: any = {
      did: form.did.trim(),
      incomingDid: form.incomingDid.trim() || undefined,
      description: form.description.trim() || undefined,
      iAccount: form.iAccount ? parseInt(form.iAccount) : undefined,
      translationRule: form.translationRule.trim() || undefined,
      cldTranslationRule: form.cldTranslationRule.trim() || undefined,
      cliTranslationRule: form.cliTranslationRule.trim() || undefined,
    };
    editing ? updateMut.mutate(body) : createMut.mutate(body);
  };

  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: any) => setForm(p => ({ ...p, [k]: e.target.value })) });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-blue-400" />
            {editing ? "Edit DID" : "Add DID"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1.5">
            <Label>DID Number *</Label>
            <Input data-testid="input-did" placeholder="e.g. 14155551234" {...f("did")} />
          </div>
          <div className="space-y-1.5">
            <Label>Incoming DID {editing ? "" : "*"}</Label>
            <Input data-testid="input-incoming-did" placeholder="e.g. 14155551234" {...f("incomingDid")} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Assign to Account</Label>
            <Select value={form.iAccount} onValueChange={v => setForm(p => ({ ...p, iAccount: v }))}>
              <SelectTrigger data-testid="select-account">
                <SelectValue placeholder="— Unassigned —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— Unassigned —</SelectItem>
                {accounts.map(a => (
                  <SelectItem key={a.iAccount} value={String(a.iAccount)}>{a.username} (#{a.iAccount})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Description</Label>
            <Input data-testid="input-description" placeholder="Optional label" {...f("description")} />
          </div>
          <div className="space-y-1.5">
            <Label>Translation Rule</Label>
            <Input data-testid="input-translation-rule" placeholder="e.g. s/^/1/" {...f("translationRule")} />
          </div>
          <div className="space-y-1.5">
            <Label>CLD Translation Rule</Label>
            <Input data-testid="input-cld-rule" placeholder="e.g. s/^1//" {...f("cldTranslationRule")} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>CLI Translation Rule</Label>
            <Input data-testid="input-cli-rule" placeholder="Optional regex" {...f("cliTranslationRule")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button data-testid="button-save-did" onClick={handleSubmit} disabled={isPending}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            {editing ? "Save Changes" : "Add DID"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmModal({ did, onClose }: { did: DID; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/sippy/dids/${did.iDid}`),
    onSuccess: () => { toast({ title: `DID ${did.did} deleted` }); qc.invalidateQueries({ queryKey: ["/api/sippy/dids"] }); onClose(); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-400">
            <Trash2 className="w-4 h-4" /> Delete DID
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          Permanently delete <span className="font-mono font-semibold text-foreground">{did.did}</span>?
          This cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleteMut.isPending}>Cancel</Button>
          <Button
            data-testid="button-confirm-delete-did"
            variant="destructive"
            onClick={() => deleteMut.mutate()}
            disabled={deleteMut.isPending}
          >
            {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DIDsPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canEdit = role === "admin" || role === "management";

  const [search, setSearch]       = useState("");
  const [filterAcct, setFilterAcct] = useState("");
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<DID | null>(null);
  const [delTarget, setDelTarget] = useState<DID | null>(null);

  const { data: didData, isLoading } = useQuery<DIDListResponse>({
    queryKey: ["/api/sippy/dids"],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: acctData } = useQuery<{ success: boolean; accounts: AccountOption[] }>({
    queryKey: ["/api/sippy/accounts"],
  });

  const accounts: AccountOption[] = acctData?.accounts ?? [];
  const allDids = didData?.dids ?? [];

  const filtered = allDids.filter(d => {
    const matchSearch = !search ||
      d.did.includes(search) ||
      (d.incomingDid ?? "").includes(search) ||
      (d.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchAcct = !filterAcct || String(d.iAccount) === filterAcct;
    return matchSearch && matchAcct;
  });

  const accountName = (iAccount: number | null) => {
    if (!iAccount) return null;
    return accounts.find(a => a.iAccount === iAccount)?.username ?? `#${iAccount}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Phone className="w-6 h-6 text-blue-400" />
            <h2 className="text-2xl font-bold tracking-tight">DID Management</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Direct Inward Dialing numbers · {allDids.length} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="button-refresh-dids"
            variant="outline" size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["/api/sippy/dids"] })}
            disabled={isLoading}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} /> Refresh
          </Button>
          {canEdit && (
            <Button
              data-testid="button-add-did"
              size="sm"
              onClick={() => { setEditing(null); setShowForm(true); }}
            >
              <Plus className="w-4 h-4 mr-2" /> Add DID
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="input-search-did"
            className="pl-9"
            placeholder="Search DID, description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterAcct} onValueChange={setFilterAcct}>
          <SelectTrigger data-testid="select-filter-account" className="w-52">
            <Filter className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All accounts</SelectItem>
            <SelectItem value="null">Unassigned</SelectItem>
            {accounts.map(a => (
              <SelectItem key={a.iAccount} value={String(a.iAccount)}>{a.username}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading DIDs from Sippy…
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Phone className="w-10 h-10 opacity-20" />
          <p className="text-sm">{allDids.length === 0 ? "No DIDs found in Sippy." : "No DIDs match your filters."}</p>
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 && (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">DID Number</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Incoming DID</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Account</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Translation</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Delegation</th>
                  {canEdit && <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((d, i) => (
                  <tr
                    key={d.iDid}
                    data-testid={`row-did-${d.iDid}`}
                    className={cn("border-b border-border/30 hover:bg-muted/10 transition-colors", i % 2 === 0 ? "" : "bg-muted/5")}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold text-blue-400">{d.did}</span>
                      {d.didRangeEnd && (
                        <span className="text-xs text-muted-foreground ml-1">–{d.didRangeEnd}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {d.incomingDid ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {d.iAccount ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {accountName(d.iAccount)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate">
                      {d.description ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {(d.translationRule || d.cldTranslationRule || d.cliTranslationRule) ? (
                        <div className="space-y-0.5">
                          {d.translationRule    && <div className="text-[10px] font-mono bg-muted/30 px-1.5 py-0.5 rounded text-amber-400">{d.translationRule}</div>}
                          {d.cldTranslationRule && <div className="text-[10px] font-mono bg-muted/30 px-1.5 py-0.5 rounded text-violet-400">CLD: {d.cldTranslationRule}</div>}
                          {d.cliTranslationRule && <div className="text-[10px] font-mono bg-muted/30 px-1.5 py-0.5 rounded text-blue-400">CLI: {d.cliTranslationRule}</div>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {d.delegatedTo ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-violet-400">
                          <Link2 className="w-3 h-3" /> #{d.delegatedTo}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            data-testid={`button-edit-did-${d.iDid}`}
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => { setEditing(d); setShowForm(true); }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            data-testid={`button-delete-did-${d.iDid}`}
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-400"
                            onClick={() => setDelTarget(d)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-border/30 bg-muted/10 text-xs text-muted-foreground">
            Showing {filtered.length} of {allDids.length} DIDs
          </div>
        </div>
      )}

      {showForm && (
        <DIDFormModal
          open={showForm}
          onClose={() => { setShowForm(false); setEditing(null); }}
          editing={editing}
          accounts={accounts}
        />
      )}
      {delTarget && <DeleteConfirmModal did={delTarget} onClose={() => setDelTarget(null)} />}
    </div>
  );
}
