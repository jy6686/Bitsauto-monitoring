import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { RefreshCw, Plus, Pencil, Trash2, Search, Download, Users } from "lucide-react";
import type { ClientIdentity } from "@shared/schema";

const RISK_TIERS = ["low", "standard", "elevated", "critical"] as const;

const riskColor: Record<string, string> = {
  low:      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  standard: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  elevated: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

type FormState = {
  iAccount: string;
  sippyUsername: string;
  billingName: string;
  displayName: string;
  crmName: string;
  portalName: string;
  externalRef: string;
  accountManagerId: string;
  financeOwnerId: string;
  riskTier: string;
  notes: string;
  active: boolean;
};

const emptyForm = (): FormState => ({
  iAccount: "", sippyUsername: "", billingName: "", displayName: "",
  crmName: "", portalName: "", externalRef: "", accountManagerId: "",
  financeOwnerId: "", riskTier: "standard", notes: "", active: true,
});

function identityToForm(r: ClientIdentity): FormState {
  return {
    iAccount:         r.iAccount != null ? String(r.iAccount) : "",
    sippyUsername:    r.sippyUsername    ?? "",
    billingName:      r.billingName      ?? "",
    displayName:      r.displayName      ?? "",
    crmName:          r.crmName          ?? "",
    portalName:       r.portalName       ?? "",
    externalRef:      r.externalRef      ?? "",
    accountManagerId: r.accountManagerId ?? "",
    financeOwnerId:   r.financeOwnerId   ?? "",
    riskTier:         r.riskTier         ?? "standard",
    notes:            r.notes            ?? "",
    active:           r.active,
  };
}

export default function ClientIdentityPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ClientIdentity | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [confirmDelete, setConfirmDelete] = useState<ClientIdentity | null>(null);

  const { data, isLoading, refetch } = useQuery<{ identities: ClientIdentity[] }>({
    queryKey: ["/api/identity"],
  });

  const identities = (data?.identities ?? []).filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.billingName ?? "").toLowerCase().includes(q) ||
      (r.displayName ?? "").toLowerCase().includes(q) ||
      (r.sippyUsername ?? "").toLowerCase().includes(q) ||
      (r.crmName ?? "").toLowerCase().includes(q) ||
      String(r.iAccount ?? "").includes(q)
    );
  });

  const upsertMut = useMutation({
    mutationFn: async (payload: object) => {
      if (editing && !isNew) {
        return apiRequest("PATCH", `/api/identity/${editing.id}`, payload);
      }
      return apiRequest("POST", "/api/identity", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/identity"] });
      setEditing(null); setIsNew(false);
      toast({ title: isNew ? "Identity created" : "Identity updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/identity/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/identity"] });
      setConfirmDelete(null);
      toast({ title: "Identity deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seedMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/identity/seed", {}),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/identity"] });
      toast({ title: `Seeded ${d.seeded ?? 0} identities from Sippy` });
    },
    onError: (e: any) => toast({ title: "Seed failed", description: e.message, variant: "destructive" }),
  });

  function openNew() {
    setForm(emptyForm());
    setEditing(null);
    setIsNew(true);
  }

  function openEdit(r: ClientIdentity) {
    setForm(identityToForm(r));
    setEditing(r);
    setIsNew(false);
  }

  function handleSave() {
    const payload: Record<string, unknown> = {
      sippyUsername:    form.sippyUsername    || null,
      billingName:      form.billingName      || null,
      displayName:      form.displayName      || null,
      crmName:          form.crmName          || null,
      portalName:       form.portalName       || null,
      externalRef:      form.externalRef      || null,
      accountManagerId: form.accountManagerId || null,
      financeOwnerId:   form.financeOwnerId   || null,
      riskTier:         form.riskTier,
      notes:            form.notes            || null,
      active:           form.active,
    };
    if (form.iAccount) payload.iAccount = parseInt(form.iAccount, 10);
    upsertMut.mutate(payload);
  }

  function setF(k: keyof FormState, v: string | boolean) {
    setForm(f => ({ ...f, [k]: v }));
  }

  const dialogOpen = isNew || editing != null;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Client Identity Map
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Canonical identity resolution layer — source of truth for all invoices, DMR, reconciliation and AI assurance.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            data-testid="button-refresh-identity"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => seedMut.mutate()}
            disabled={seedMut.isPending}
            data-testid="button-seed-from-sippy"
          >
            <Download className="w-4 h-4 mr-1" />
            {seedMut.isPending ? "Seeding…" : "Seed from Sippy"}
          </Button>
          <Button size="sm" onClick={openNew} data-testid="button-new-identity">
            <Plus className="w-4 h-4 mr-1" />
            New Identity
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Identities", value: data?.identities.length ?? 0 },
          { label: "Active", value: data?.identities.filter(r => r.active).length ?? 0 },
          { label: "Elevated / Critical", value: data?.identities.filter(r => ["elevated","critical"].includes(r.riskTier ?? "")).length ?? 0 },
          { label: "Sippy-Linked", value: data?.identities.filter(r => r.iAccount != null).length ?? 0 },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold mt-1" data-testid={`stat-${s.label.toLowerCase().replace(/\W+/g,"-")}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search name, username, account ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-identity-search"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>i_account</TableHead>
                <TableHead>Sippy Username</TableHead>
                <TableHead>Billing Name</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>CRM Name</TableHead>
                <TableHead>External Ref</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : identities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No identities found.{" "}
                    <button
                      className="underline text-primary"
                      onClick={() => seedMut.mutate()}
                    >
                      Seed from Sippy
                    </button>{" "}
                    to auto-populate.
                  </TableCell>
                </TableRow>
              ) : identities.map(r => (
                <TableRow key={r.id} data-testid={`row-identity-${r.id}`}>
                  <TableCell className="font-mono text-sm">{r.iAccount ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.sippyUsername ?? "—"}</TableCell>
                  <TableCell className="font-medium">{r.billingName ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.displayName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.crmName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">{r.externalRef ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={`text-xs ${riskColor[r.riskTier ?? "standard"]}`}>
                      {r.riskTier ?? "standard"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.active ? "default" : "secondary"} className="text-xs">
                      {r.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => openEdit(r)}
                        data-testid={`button-edit-identity-${r.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setConfirmDelete(r)}
                        data-testid={`button-delete-identity-${r.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit / New dialog */}
      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) { setEditing(null); setIsNew(false); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "New Client Identity" : "Edit Client Identity"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1">
              <Label>Sippy i_account</Label>
              <Input
                type="number"
                value={form.iAccount}
                onChange={e => setF("iAccount", e.target.value)}
                placeholder="e.g. 1234"
                data-testid="input-identity-iaccount"
              />
            </div>
            <div className="space-y-1">
              <Label>Sippy Username</Label>
              <Input
                value={form.sippyUsername}
                onChange={e => setF("sippyUsername", e.target.value)}
                placeholder="e.g. client_acme"
                data-testid="input-identity-username"
              />
            </div>
            <div className="space-y-1">
              <Label>Billing Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.billingName}
                onChange={e => setF("billingName", e.target.value)}
                placeholder="Legal / invoice name"
                data-testid="input-identity-billing-name"
              />
            </div>
            <div className="space-y-1">
              <Label>Display Name</Label>
              <Input
                value={form.displayName}
                onChange={e => setF("displayName", e.target.value)}
                placeholder="UI-friendly label"
                data-testid="input-identity-display-name"
              />
            </div>
            <div className="space-y-1">
              <Label>CRM Name</Label>
              <Input
                value={form.crmName}
                onChange={e => setF("crmName", e.target.value)}
                placeholder="CRM / commercial name"
                data-testid="input-identity-crm-name"
              />
            </div>
            <div className="space-y-1">
              <Label>Portal Name</Label>
              <Input
                value={form.portalName}
                onChange={e => setF("portalName", e.target.value)}
                placeholder="Client-portal branding"
                data-testid="input-identity-portal-name"
              />
            </div>
            <div className="space-y-1">
              <Label>External Ref</Label>
              <Input
                value={form.externalRef}
                onChange={e => setF("externalRef", e.target.value)}
                placeholder="ERP / CRM ID"
                data-testid="input-identity-external-ref"
              />
            </div>
            <div className="space-y-1">
              <Label>Risk Tier</Label>
              <Select value={form.riskTier} onValueChange={v => setF("riskTier", v)}>
                <SelectTrigger data-testid="select-identity-risk-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_TIERS.map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Account Manager ID</Label>
              <Input
                value={form.accountManagerId}
                onChange={e => setF("accountManagerId", e.target.value)}
                placeholder="KAM user ID"
                data-testid="input-identity-account-manager"
              />
            </div>
            <div className="space-y-1">
              <Label>Finance Owner ID</Label>
              <Input
                value={form.financeOwnerId}
                onChange={e => setF("financeOwnerId", e.target.value)}
                placeholder="Finance escalation user ID"
                data-testid="input-identity-finance-owner"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={e => setF("notes", e.target.value)}
                rows={2}
                placeholder="Optional operational notes"
                data-testid="input-identity-notes"
              />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <Switch
                checked={form.active}
                onCheckedChange={v => setF("active", v)}
                data-testid="switch-identity-active"
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setIsNew(false); }}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={upsertMut.isPending} data-testid="button-save-identity">
              {upsertMut.isPending ? "Saving…" : "Save Identity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={o => { if (!o) setConfirmDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Identity</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete the identity for{" "}
            <strong>{confirmDelete?.billingName ?? confirmDelete?.sippyUsername ?? `Account ${confirmDelete?.iAccount}`}</strong>?
            This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => confirmDelete && deleteMut.mutate(confirmDelete.id)}
              data-testid="button-confirm-delete-identity"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
