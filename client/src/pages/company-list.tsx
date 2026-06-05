import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2, Plus, Search, Pencil, Trash2, Users, Globe, CreditCard,
  Zap, Loader2, Clock, CheckCircle2, XCircle, ShieldCheck, AlertTriangle,
  PlusCircle, ShieldPlus, Tag, Package, MapPin, DollarSign, Cpu, ExternalLink,
  RefreshCw, Play, AlertCircle, Server, Upload, List, Trash,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";

const TYPE_COLOR: Record<string, string> = {
  retail:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
  wholesale: "bg-violet-500/10 text-violet-400 border-violet-500/20",
};
const CONTRACT_COLOR: Record<string, string> = {
  client:    "bg-amber-500/10 text-amber-400 border-amber-500/20",
  vendor:    "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  bilateral: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};
const STATUS_COLOR: Record<string, string> = {
  active:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  inactive: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

const PRODUCT_COLOR: Record<string, string> = {
  "First Class":    "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Business Class": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Special Charlie":"bg-violet-500/10 text-violet-400 border-violet-500/20",
  "Special Bravo":  "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

interface IpRequest {
  id: number;
  ipAddress: string;
  trunk: string | null;
  description: string | null;
  status: string;
  submittedBy: string | null;
}

// ── Utility: extract 4-digit prefix from CLD rule like s/^8888// ─────────────
function extractPrefixFromCld(rule?: string): string {
  if (!rule) return "";
  const m = rule.match(/\^(\d{3,8})/);
  return m?.[1] ?? "";
}

// ── Company Info Dialog ───────────────────────────────────────────────────────
function CompanyInfoDialog({ company, open, onClose }: {
  company: Company | null;
  open: boolean;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();

  const { data: ipData, isLoading: ipsLoading } = useQuery<{ requests: IpRequest[] }>({
    queryKey: ["/api/client-ip-requests", company?.id],
    queryFn: () => fetch(`/api/client-ip-requests?companyId=${company!.id}`, { credentials: "include" }).then(r => r.json()),
    enabled: open && !!company,
  });

  if (!company) return null;

  const companyAny = company as any;
  const draft = companyAny.wizardDraft ? (() => { try { return JSON.parse(companyAny.wizardDraft); } catch { return null; } })() : null;

  const approvedIps = (ipData?.requests ?? []).filter(r => r.status === "approved");
  const pendingIps  = (ipData?.requests ?? []).filter(r => r.status === "pending");
  const rejectedIps = (ipData?.requests ?? []).filter(r => r.status === "rejected");

  // Prefix: from step1.prefix or parsed from first trunk's CLD rule
  const prefix = draft?.step1?.prefix
    || (draft?.trunks?.[0] ? extractPrefixFromCld(draft.trunks[0].cldTranslation) : "")
    || "";

  // Products from wizard selectedProducts, fallback to trunk names
  const products: string[] = draft?.selectedProducts ?? [];

  // Sippy username
  const sippyUser = draft?.step1?.userId || "";

  const provStatus = companyAny.provisioningStatus;
  const isProvisioned = provStatus === "provisioned";

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-400" />
            {company.name}
            <span className="text-xs text-muted-foreground font-mono font-normal ml-1">{company.shortCode}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Status badges */}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={`text-[10px] ${STATUS_COLOR[company.status] ?? ""}`}>{company.status}</Badge>
            <Badge variant="outline" className={`text-[10px] ${TYPE_COLOR[company.companyType] ?? ""}`}>{company.companyType}</Badge>
            <Badge variant="outline" className={`text-[10px] ${CONTRACT_COLOR[company.contractType] ?? ""}`}>{company.contractType}</Badge>
            {isProvisioned && (
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                <Zap className="h-2.5 w-2.5 mr-1" />provisioned
              </Badge>
            )}
            {provStatus === "pending_provision" && (
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                <Clock className="h-2.5 w-2.5 mr-1" />awaiting provision
              </Badge>
            )}
          </div>

          {/* Core info grid */}
          <div className="grid grid-cols-2 gap-3">
            <InfoRow icon={<Users className="h-3.5 w-3.5 text-blue-400" />} label="KAM">
              <button
                className="text-xs font-medium text-blue-400 hover:underline"
                onClick={() => { onClose(); }}
              >
                {company.kam || "—"}
              </button>
            </InfoRow>

            <InfoRow icon={<MapPin className="h-3.5 w-3.5 text-emerald-400" />} label="Location">
              <span className="text-xs font-medium">{company.country || "—"}</span>
            </InfoRow>

            <InfoRow icon={<DollarSign className="h-3.5 w-3.5 text-amber-400" />} label="Currency">
              <span className="text-xs font-medium">{company.currency || "—"} · {company.paymentTerm || "—"}</span>
            </InfoRow>

            <InfoRow icon={<Tag className="h-3.5 w-3.5 text-violet-400" />} label="Account Prefix">
              {prefix
                ? <span className="text-xs font-mono font-medium text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded">{prefix}</span>
                : <span className="text-xs text-muted-foreground">Not set</span>
              }
            </InfoRow>

            {sippyUser && (
              <InfoRow icon={<Cpu className="h-3.5 w-3.5 text-cyan-400" />} label="Sippy Username">
                <span className="text-xs font-mono font-medium text-cyan-300">{sippyUser}</span>
              </InfoRow>
            )}

            {companyAny.sippyIAccount && (
              <InfoRow icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />} label="Sippy i_account">
                <span className="text-xs font-mono font-medium text-emerald-300">#{companyAny.sippyIAccount}</span>
              </InfoRow>
            )}
          </div>

          {/* IP Summary */}
          <div className="border border-border/40 rounded-lg p-3 space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">IP Addresses</p>
            {ipsLoading ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="font-semibold">{approvedIps.length}</span> approved
                </span>
                <span className="flex items-center gap-1 text-amber-400">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="font-semibold">{pendingIps.length}</span> pending
                </span>
                {rejectedIps.length > 0 && (
                  <span className="flex items-center gap-1 text-rose-400">
                    <XCircle className="h-3.5 w-3.5" />
                    <span className="font-semibold">{rejectedIps.length}</span> rejected
                  </span>
                )}
              </div>
            )}
            {approvedIps.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {approvedIps.map(ip => (
                  <span key={ip.id} className="text-[10px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded px-1.5 py-0.5">
                    {ip.ipAddress}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Products Offered */}
          {products.length > 0 && (
            <div className="border border-border/40 rounded-lg p-3 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Package className="h-3 w-3" /> Products Offered
              </p>
              <div className="flex flex-wrap gap-1.5">
                {products.map(p => (
                  <Badge key={p} variant="outline" className={`text-[10px] ${PRODUCT_COLOR[p] ?? "bg-muted/30 text-muted-foreground"}`}>
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* CLD rule details */}
          {draft?.trunks?.length > 0 && (
            <div className="border border-border/40 rounded-lg p-3 space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Trunk Configuration</p>
              {draft.trunks.map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-20 shrink-0 truncate">{t.trunkName || `Trunk ${i + 1}`}</span>
                  <span className="font-mono text-[10px] bg-muted/30 px-1.5 py-0.5 rounded text-muted-foreground truncate flex-1">
                    {t.cldTranslation || "s/^//"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Link href={`/company/edit/${company.id}`}>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onClose}>
                <Pencil className="h-3 w-3" /> Edit Company
              </Button>
            </Link>
            {!isProvisioned && (
              <Link href={`/client-wizard`}>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10" onClick={onClose}>
                  <Zap className="h-3 w-3" /> Client Wizard
                </Button>
              </Link>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  );
}

// ── Provisioning Panel ────────────────────────────────────────────────────────
function ProvisioningPanel({ company }: { company: Company }) {
  const { toast } = useToast();
  const companyAny = company as any;
  const hasWizardDraft = !!companyAny.wizardDraft;

  const [showAddIp, setShowAddIp] = useState(false);
  const [newIp, setNewIp] = useState("");
  const [newTrunk, setNewTrunk] = useState("");

  const { data: ipData, isLoading: ipsLoading } = useQuery<{ requests: IpRequest[] }>({
    queryKey: ["/api/client-ip-requests", company.id],
    queryFn: () => fetch(`/api/client-ip-requests?companyId=${company.id}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: false,
  });

  const addIpMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-ip-requests", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests", company.id] });
      setNewIp("");
      setNewTrunk("");
      setShowAddIp(false);
      toast({ title: "IP submitted for approval" });
    },
    onError: (e: any) => toast({ title: "Failed to add IP", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/client-ip-requests/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests", company.id] });
      toast({ title: "IP approved" });
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/client-ip-requests/${id}/reject`, { reason: "Rejected from Companies page" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests", company.id] });
      toast({ title: "IP rejected" });
    },
    onError: (e: any) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const provisionMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${company.id}/provision`),
    onSuccess: async (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      let data: any = {};
      try { data = typeof res?.json === 'function' ? await res.json() : res; } catch {}
      const authErrors: string[] = data?.authErrors ?? [];
      const spNote: string = data?.servicePlanNote ?? '';
      const tariffNote: string = data?.tariffNote ?? '';
      const iTariff: number | undefined = data?.iTariff;
      const tariffCreated: boolean = data?.tariffCreated ?? false;

      const noteParts: string[] = [];
      if (tariffNote) noteParts.push(tariffNote);
      if (spNote)     noteParts.push(spNote);
      const fullNote = noteParts.join(' · ');

      if (authErrors.length > 0) {
        toast({
          title: `${company.name} provisioned — IP auth failed`,
          description: `Auth rule error(s): ${authErrors.join('; ')}${fullNote ? '\n' + fullNote : ''}`,
          variant: "destructive",
        });
      } else if (tariffCreated && iTariff) {
        toast({
          title: `${company.name} provisioned to Sippy`,
          description: `Tariff created (i_tariff=${iTariff})${spNote ? ' · ' + spNote : ''}`,
          variant: "default",
        });
      } else if (fullNote) {
        toast({
          title: `${company.name} provisioned to Sippy`,
          description: fullNote,
          variant: "default",
        });
      } else {
        toast({ title: `${company.name} provisioned to Sippy` });
      }
    },
    onError: (e: any) => toast({ title: "Provisioning failed", description: e.message, variant: "destructive" }),
  });

  const handleAddIp = () => {
    const ip = newIp.trim();
    if (!ip) return;
    addIpMutation.mutate({
      clientName: company.name,
      companyId: company.id,
      ipAddress: ip,
      trunk: newTrunk.trim() || null,
    });
  };

  // ── Rate Push state ──────────────────────────────────────────────────────
  const isProvisioned = !!(companyAny.sippyIAccount);
  const hasTariff     = !!(companyAny.sippyITariff);

  const [showRatePanel, setShowRatePanel] = useState(false);
  const [rateRows, setRateRows] = useState<{ prefix: string; rate: string }[]>([{ prefix: "", rate: "" }]);

  const { data: tariffData, isFetching: tariffFetching, refetch: refetchTariff } = useQuery<{ iTariff: number; rates: any[] }>({
    queryKey: [`/api/companies/${company.id}/tariff-rates`],
    queryFn: () => fetch(`/api/companies/${company.id}/tariff-rates`, { credentials: "include" }).then(r => r.json()),
    enabled: isProvisioned && hasTariff && showRatePanel,
  });

  const pushRatesMutation = useMutation({
    mutationFn: async (rates: { prefix: string; rate: number }[]) => {
      const res = await apiRequest("POST", `/api/companies/${company.id}/push-rates`, { rates });
      return typeof res?.json === 'function' ? res.json() : res;
    },
    onSuccess: (data: any) => {
      refetchTariff();
      toast({ title: `Rates pushed`, description: `${data.pushed} pushed, ${data.failed} failed` });
      setRateRows([{ prefix: "", rate: "" }]);
    },
    onError: (e: any) => toast({ title: "Push failed", description: e.message, variant: "destructive" }),
  });

  const handlePushRates = () => {
    const valid = rateRows.filter(r => r.prefix.trim() && r.rate.trim() && !isNaN(Number(r.rate)));
    if (!valid.length) { toast({ title: "Enter at least one valid prefix/rate", variant: "destructive" }); return; }
    pushRatesMutation.mutate(valid.map(r => ({ prefix: r.prefix.trim(), rate: Number(r.rate) })));
  };

  // ── Product Assignment state ──────────────────────────────────────────────
  const [showProductPanel, setShowProductPanel] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  const { data: assignedProducts = [], refetch: refetchProducts } = useQuery<any[]>({
    queryKey: [`/api/companies/${company.id}/products`],
    queryFn: () => fetch(`/api/companies/${company.id}/products`, { credentials: "include" }).then(r => r.json()),
    enabled: isProvisioned && showProductPanel,
  });

  const { data: allProducts = [] } = useQuery<any[]>({
    queryKey: ["/api/products"],
    queryFn: () => fetch("/api/products?status=commercial", { credentials: "include" }).then(r => r.json()),
    enabled: isProvisioned && showProductPanel,
  });

  const assignProductMutation = useMutation({
    mutationFn: async (productId: number) => {
      const res = await apiRequest("POST", `/api/companies/${company.id}/products`, { productId });
      return typeof res?.json === 'function' ? res.json() : res;
    },
    onSuccess: () => {
      refetchProducts();
      setSelectedProductId("");
      toast({ title: "Product assigned" });
    },
    onError: (e: any) => toast({ title: "Assign failed", description: e.message, variant: "destructive" }),
  });

  const removeProductMutation = useMutation({
    mutationFn: (assignmentId: number) => apiRequest("DELETE", `/api/companies/${company.id}/products/${assignmentId}`),
    onSuccess: () => { refetchProducts(); toast({ title: "Product removed" }); },
    onError: (e: any) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  const allRequests = ipData?.requests ?? [];
  const pendingIps = allRequests.filter(r => r.status === "pending");
  const approvedIps = allRequests.filter(r => r.status === "approved");
  const rejectedIps = allRequests.filter(r => r.status === "rejected");
  const canProvision = hasWizardDraft && pendingIps.length === 0 && approvedIps.length > 0;

  if (ipsLoading) {
    return (
      <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading IP requests…
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/40 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          IP Approval ({approvedIps.length} approved · {pendingIps.length} pending{rejectedIps.length > 0 ? ` · ${rejectedIps.length} rejected` : ""})
        </p>
        <button
          data-testid={`btn-add-ip-toggle-${company.id}`}
          onClick={() => setShowAddIp(v => !v)}
          className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
        >
          <PlusCircle className="h-3 w-3" /> Add IP
        </button>
      </div>

      {showAddIp && (
        <div className="flex gap-1.5 items-center border border-blue-500/20 bg-blue-500/5 rounded px-2 py-1.5">
          <Input
            data-testid={`input-new-ip-${company.id}`}
            placeholder="IP address (e.g. 1.2.3.4)"
            className="h-6 text-xs font-mono flex-1 border-blue-500/30 bg-transparent focus:border-blue-400"
            value={newIp}
            onChange={e => setNewIp(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddIp()}
          />
          <Input
            data-testid={`input-new-trunk-${company.id}`}
            placeholder="Trunk (opt)"
            className="h-6 text-xs w-24 border-blue-500/30 bg-transparent focus:border-blue-400"
            value={newTrunk}
            onChange={e => setNewTrunk(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddIp()}
          />
          <button
            data-testid={`btn-submit-ip-${company.id}`}
            onClick={handleAddIp}
            disabled={addIpMutation.isPending || !newIp.trim()}
            className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10 rounded px-1.5 py-1 transition-colors disabled:opacity-40"
          >
            {addIpMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle2 className="h-2.5 w-2.5" />} Submit
          </button>
          <button
            onClick={() => { setShowAddIp(false); setNewIp(""); setNewTrunk(""); }}
            className="text-[10px] text-muted-foreground hover:text-foreground px-1"
          >
            ✕
          </button>
        </div>
      )}

      {allRequests.length === 0 && !showAddIp && (
        <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          No IP requests yet. Click "Add IP" to submit one.
        </div>
      )}

      <div className="space-y-1">
        {pendingIps.map(ip => (
          <div key={ip.id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-amber-500/20 bg-amber-500/5">
            <Clock className="h-3 w-3 text-amber-400 shrink-0" />
            <span className="text-xs font-mono flex-1 truncate text-amber-300">{ip.ipAddress}</span>
            {ip.trunk && <span className="text-[10px] text-muted-foreground shrink-0">{ip.trunk}</span>}
            <button
              data-testid={`btn-approve-ip-${ip.id}`}
              onClick={() => approveMutation.mutate(ip.id)}
              disabled={approveMutation.isPending}
              className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10 rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="h-2.5 w-2.5" /> Approve
            </button>
            <button
              data-testid={`btn-reject-ip-${ip.id}`}
              onClick={() => rejectMutation.mutate(ip.id)}
              disabled={rejectMutation.isPending}
              className="flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300 border border-rose-500/30 hover:bg-rose-500/10 rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
            >
              <XCircle className="h-2.5 w-2.5" /> Reject
            </button>
          </div>
        ))}

        {approvedIps.map(ip => (
          <div key={ip.id} className="flex items-center gap-2 px-2 py-1 rounded border border-emerald-500/20 bg-emerald-500/5">
            <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
            <span className="text-xs font-mono flex-1 truncate text-emerald-300">{ip.ipAddress}</span>
            {ip.trunk && <span className="text-[10px] text-muted-foreground shrink-0">{ip.trunk}</span>}
            <span className="text-[10px] text-emerald-400">Approved</span>
          </div>
        ))}

        {rejectedIps.map(ip => (
          <div key={ip.id} className="flex items-center gap-2 px-2 py-1 rounded border border-rose-500/20 bg-rose-500/5 opacity-60">
            <XCircle className="h-3 w-3 text-rose-400 shrink-0" />
            <span className="text-xs font-mono flex-1 truncate text-rose-300 line-through">{ip.ipAddress}</span>
            <span className="text-[10px] text-rose-400">Rejected</span>
          </div>
        ))}
      </div>

      {pendingIps.length > 0 && (
        <p className="text-[10px] text-amber-400 flex items-center gap-1">
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
          Approve all pending IPs before provisioning.
        </p>
      )}

      {!hasWizardDraft && (
        <p className="text-[10px] text-blue-400 flex items-center gap-1 bg-blue-500/5 border border-blue-500/20 rounded px-2 py-1.5">
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
          Complete the Client Wizard to enable provisioning.
        </p>
      )}

      {hasWizardDraft && <PreProvisionChecks company={company} />}

      {canProvision ? (
        <Button
          data-testid={`btn-provision-company-${company.id}`}
          size="sm"
          className="w-full h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => {
            if (confirm(`Provision "${company.name}" to Sippy?\n\nThis will create the Sippy account and push ${approvedIps.length} auth rule(s).`))
              provisionMutation.mutate();
          }}
          disabled={provisionMutation.isPending}
        >
          {provisionMutation.isPending
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Provisioning…</>
            : <><Zap className="h-3 w-3" /> Provision to Sippy ({approvedIps.length} IP{approvedIps.length !== 1 ? "s" : ""})</>
          }
        </Button>
      ) : (
        <Button
          data-testid={`btn-provision-company-${company.id}`}
          size="sm"
          className="w-full h-7 text-xs gap-1.5"
          variant="outline"
          disabled
        >
          <Zap className="h-3 w-3" />
          Provision to Sippy
          {pendingIps.length > 0 && <Badge variant="outline" className="ml-1 text-[9px] text-amber-400 border-amber-500/30">{pendingIps.length} pending</Badge>}
          {!hasWizardDraft && <Badge variant="outline" className="ml-1 text-[9px] text-blue-400 border-blue-500/30">wizard required</Badge>}
        </Button>
      )}

      {/* ── Rate Push Panel (only when provisioned with tariff) ─────────────── */}
      {isProvisioned && (
        <div className="border-t border-border/40 pt-2 mt-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Upload className="h-2.5 w-2.5" />
              Rate Sheet
              {hasTariff && (
                <span className="text-[9px] font-mono text-violet-400 ml-1">tariff #{companyAny.sippyITariff}</span>
              )}
            </p>
            <button
              data-testid={`btn-toggle-rate-panel-${company.id}`}
              onClick={() => setShowRatePanel(v => !v)}
              className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
            >
              {showRatePanel ? "Hide" : "Manage"}
            </button>
          </div>

          {showRatePanel && !hasTariff && (
            <p className="mt-1 text-[10px] text-amber-400 flex items-center gap-1 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              No Sippy tariff linked. Re-provision to auto-create one.
            </p>
          )}

          {showRatePanel && hasTariff && (
            <div className="mt-1.5 space-y-1.5">
              {/* Current rates */}
              {tariffFetching && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> Loading live rates…
                </div>
              )}
              {tariffData && !tariffFetching && (
                <div className="rounded border border-border/30 bg-background/40 overflow-hidden">
                  <div className="flex items-center justify-between px-2 py-1 border-b border-border/30">
                    <span className="text-[10px] text-muted-foreground">
                      <List className="h-2.5 w-2.5 inline mr-1" />
                      {tariffData.rates?.length ?? 0} rate{(tariffData.rates?.length ?? 0) !== 1 ? "s" : ""} on tariff
                    </span>
                    <button onClick={() => refetchTariff()} className="text-[9px] text-blue-400 hover:text-blue-300">
                      <RefreshCw className="h-2.5 w-2.5 inline" /> refresh
                    </button>
                  </div>
                  {(tariffData.rates?.length ?? 0) > 0 && (
                    <div className="max-h-28 overflow-y-auto divide-y divide-border/20">
                      {tariffData.rates.slice(0, 20).map((r: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-2 py-0.5">
                          <span className="text-[10px] font-mono text-foreground/80">{r.prefix ?? r.i_prefix ?? r.destination ?? "—"}</span>
                          <span className="text-[10px] font-mono text-emerald-400">{r.price ?? r.rate ?? r.i_rate ?? "—"}</span>
                        </div>
                      ))}
                      {tariffData.rates.length > 20 && (
                        <p className="text-[9px] text-muted-foreground text-center py-0.5">+ {tariffData.rates.length - 20} more</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Push new rates */}
              <div className="rounded border border-violet-500/20 bg-violet-500/5 p-2 space-y-1.5">
                <p className="text-[10px] font-medium text-violet-300">Push rates to Sippy tariff</p>
                {rateRows.map((row, idx) => (
                  <div key={idx} className="flex gap-1.5 items-center">
                    <Input
                      data-testid={`input-rate-prefix-${company.id}-${idx}`}
                      placeholder="Prefix (e.g. 44)"
                      value={row.prefix}
                      onChange={e => setRateRows(rows => rows.map((r, i) => i === idx ? { ...r, prefix: e.target.value } : r))}
                      className="h-6 text-xs font-mono flex-1 border-violet-500/30 bg-transparent focus:border-violet-400"
                    />
                    <Input
                      data-testid={`input-rate-value-${company.id}-${idx}`}
                      placeholder="Rate (e.g. 0.012)"
                      value={row.rate}
                      onChange={e => setRateRows(rows => rows.map((r, i) => i === idx ? { ...r, rate: e.target.value } : r))}
                      className="h-6 text-xs font-mono w-28 border-violet-500/30 bg-transparent focus:border-violet-400"
                    />
                    {rateRows.length > 1 && (
                      <button onClick={() => setRateRows(rows => rows.filter((_, i) => i !== idx))} className="text-rose-400 hover:text-rose-300">
                        <XCircle className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setRateRows(rows => [...rows, { prefix: "", rate: "" }])}
                    className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-0.5"
                  >
                    <PlusCircle className="h-2.5 w-2.5" /> Add row
                  </button>
                  <button
                    data-testid={`btn-push-rates-${company.id}`}
                    onClick={handlePushRates}
                    disabled={pushRatesMutation.isPending}
                    className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10 rounded px-2 py-0.5 transition-colors disabled:opacity-40"
                  >
                    {pushRatesMutation.isPending
                      ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Pushing…</>
                      : <><Upload className="h-2.5 w-2.5" /> Push to Sippy</>
                    }
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Product Assignment Panel ─────────────────────────────────────────── */}
      {isProvisioned && (
        <div className="border-t border-border/40 pt-2 mt-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Package className="h-2.5 w-2.5" />
              Products
              {assignedProducts.length > 0 && (
                <Badge variant="outline" className="ml-1 text-[9px] text-emerald-400 border-emerald-500/30">
                  {assignedProducts.length}
                </Badge>
              )}
            </p>
            <button
              data-testid={`btn-toggle-product-panel-${company.id}`}
              onClick={() => setShowProductPanel(v => !v)}
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              {showProductPanel ? "Hide" : "Assign"}
            </button>
          </div>

          {showProductPanel && (
            <div className="mt-1.5 space-y-1.5">
              {/* Assigned products list */}
              {assignedProducts.length > 0 && (
                <div className="rounded border border-border/30 bg-background/40 divide-y divide-border/20 overflow-hidden">
                  {assignedProducts.map((a: any) => (
                    <div key={a.id} className="flex items-center gap-2 px-2 py-1">
                      <div
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: a.productColor ?? '#6366f1' }}
                      />
                      <span className="text-[10px] flex-1 text-foreground/80 truncate">{a.productName ?? `Product #${a.productId}`}</span>
                      {a.productCode && <span className="text-[9px] font-mono text-muted-foreground">{a.productCode}</span>}
                      <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30">active</Badge>
                      <button
                        data-testid={`btn-remove-product-${company.id}-${a.id}`}
                        onClick={() => removeProductMutation.mutate(a.id)}
                        disabled={removeProductMutation.isPending}
                        className="text-rose-400 hover:text-rose-300 transition-colors disabled:opacity-40 ml-1"
                        title="Remove assignment"
                      >
                        <Trash className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {assignedProducts.length === 0 && (
                <p className="text-[10px] text-muted-foreground/60 italic">No products assigned yet.</p>
              )}

              {/* Assign new product */}
              <div className="flex gap-1.5 items-center">
                <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                  <SelectTrigger
                    data-testid={`select-product-assign-${company.id}`}
                    className="h-6 text-xs flex-1 border-blue-500/30 bg-transparent focus:border-blue-400"
                  >
                    <SelectValue placeholder="Select commercial product…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allProducts.map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name} {p.code ? `(${p.code})` : ""}
                      </SelectItem>
                    ))}
                    {allProducts.length === 0 && (
                      <SelectItem value="_none" disabled>No commercial products available</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <button
                  data-testid={`btn-assign-product-${company.id}`}
                  onClick={() => selectedProductId && selectedProductId !== "_none" && assignProductMutation.mutate(Number(selectedProductId))}
                  disabled={!selectedProductId || selectedProductId === "_none" || assignProductMutation.isPending}
                  className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:bg-blue-500/10 rounded px-2 py-1 transition-colors disabled:opacity-40"
                >
                  {assignProductMutation.isPending
                    ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    : <PlusCircle className="h-2.5 w-2.5" />
                  }
                  Assign
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pre-Provision Checks ──────────────────────────────────────────────────────
type CheckStatus = 'ok' | 'warning' | 'error';
type ProvCheck = { type: string; status: CheckStatus; message: string; conflictWith?: string; field?: string };

function CheckStatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'ok')      return <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />;
  if (status === 'warning') return <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />;
  return <XCircle className="h-3 w-3 text-rose-400 shrink-0" />;
}

function PreProvisionChecks({ company }: { company: Company }) {
  const { data, isFetching, error, refetch } = useQuery<{
    checks: ProvCheck[];
    summary: { errors: number; warnings: number; total: number };
  }>({
    queryKey: ['/api/sippy/pre-provision-check', company.id],
    queryFn: () =>
      fetch(`/api/sippy/pre-provision-check?companyId=${company.id}`, { credentials: 'include' })
        .then(r => r.json()),
    enabled: false,
    staleTime: 0,
    retry: false,
  });

  const checks  = data?.checks ?? [];
  const summary = data?.summary;

  return (
    <div className="border-t border-border/40 pt-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <AlertCircle className="h-2.5 w-2.5" /> Pre-Provision Checks
        </p>
        <button
          data-testid={`btn-run-checks-${company.id}`}
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:bg-blue-500/10 rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
        >
          {isFetching
            ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Running…</>
            : <><Play className="h-2.5 w-2.5" /> Run Checks</>
          }
        </button>
      </div>

      {error && (
        <p className="text-[10px] text-rose-400 flex items-center gap-1">
          <XCircle className="h-2.5 w-2.5 shrink-0" /> Check failed — {(error as any).message}
        </p>
      )}

      {checks.length > 0 && (
        <>
          <div className="space-y-1">
            {checks.map((c, i) => (
              <button
                key={i}
                data-testid={`check-item-${company.id}-${c.field}`}
                onClick={() => refetch()}
                title="Click to re-run checks"
                className={`w-full text-left flex items-start gap-1.5 px-2 py-1.5 rounded text-[10px] border cursor-pointer hover:opacity-80 transition-opacity ${
                  c.status === 'ok'
                    ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                    : c.status === 'warning'
                    ? 'bg-amber-500/5 border-amber-500/20 text-amber-300'
                    : 'bg-rose-500/5 border-rose-500/20 text-rose-300'
                }`}
              >
                <CheckStatusIcon status={c.status} />
                <span className="leading-relaxed">{c.message}</span>
              </button>
            ))}
          </div>
          {summary && (
            <div className="flex items-center gap-2 text-[10px]">
              {summary.errors > 0   && <span className="text-rose-400">{summary.errors} error{summary.errors !== 1 ? 's' : ''}</span>}
              {summary.warnings > 0 && <span className="text-amber-400">{summary.warnings} warning{summary.warnings !== 1 ? 's' : ''}</span>}
              {summary.errors === 0 && summary.warnings === 0 && (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-2.5 w-2.5" /> All checks passed
                </span>
              )}
            </div>
          )}
        </>
      )}

      {checks.length === 0 && !isFetching && (
        <p className="text-[10px] text-muted-foreground/50">
          Click "Run Checks" to validate for duplicates before provisioning.
        </p>
      )}
    </div>
  );
}

// ── Sync Dialog ───────────────────────────────────────────────────────────────
type OrphanedAccount  = { iAccount: number; username: string; description: string; balance: number; maxSessions: number | null; blocked: boolean; currency: string };
type OrphanedAuthRule = { iAccount: number; iAuthentication: number; remoteIp: string; companyName: string; companyId: number };
type PlatformOnlyCompany = { companyId: number; companyName: string; shortCode: string; sippyIAccount: number };
type SyncPreview = {
  orphanedAccounts: OrphanedAccount[];
  orphanedAuthRules: OrphanedAuthRule[];
  platformOnlyCompanies: PlatformOnlyCompany[];
  summary: { sippyAccountCount: number; platformAccountCount: number; orphanedAccountCount: number; orphanedAuthRuleCount: number; platformOnlyCount: number };
};

type SyncTab = 'import' | 'cleanup' | 'broken';

function SyncDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [tab, setTab]                             = useState<SyncTab>('import');
  const [selectedAccounts,  setSelectedAccounts]  = useState<Set<number>>(new Set());
  const [selectedAuthRules, setSelectedAuthRules] = useState<Set<number>>(new Set());
  const [importingId,       setImportingId]       = useState<number | null>(null);
  const [importName,        setImportName]        = useState('');
  const [linkingCompanyId,  setLinkingCompanyId]  = useState<number | null>(null);
  const [linkIAccount,      setLinkIAccount]      = useState('');

  const { data, isFetching, error, refetch } = useQuery<SyncPreview>({
    queryKey: ['/api/sippy/sync/preview'],
    queryFn: () =>
      fetch('/api/sippy/sync/preview', { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error(r.status.toString()); return r.json(); }),
    enabled: open,
    staleTime: 0,
    retry: false,
  });

  const importMutation = useMutation({
    mutationFn: (payload: { iAccount: number; name: string }) =>
      apiRequest('POST', '/api/sippy/sync/import', payload),
    onSuccess: async (_res: any, vars) => {
      toast({ title: 'Account imported', description: `Sippy i_account:${vars.iAccount} has been added to the platform.` });
      setImportingId(null);
      setImportName('');
      refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
    },
    onError: (e: any) => toast({ title: 'Import failed', description: e.message, variant: 'destructive' }),
  });

  const linkMutation = useMutation({
    mutationFn: (payload: { companyId: number; iAccount: number }) =>
      apiRequest('POST', '/api/sippy/sync/link', payload),
    onSuccess: async (_res: any, vars) => {
      toast({ title: 'Linked', description: `Company linked to Sippy i_account:${vars.iAccount}.` });
      setLinkingCompanyId(null);
      setLinkIAccount('');
      refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
    },
    onError: (e: any) => toast({ title: 'Link failed', description: e.message, variant: 'destructive' }),
  });

  const executeMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sippy/sync/execute', {
      deleteAccountIds:  Array.from(selectedAccounts),
      deleteAuthRuleIds: Array.from(selectedAuthRules),
    }),
    onSuccess: async (res: any) => {
      let d: any = {};
      try { d = typeof res?.json === 'function' ? await res.json() : res; } catch {}
      const failA = (d?.accountResults  ?? []).filter((r: any) => !r.success);
      const failR = (d?.authRuleResults ?? []).filter((r: any) => !r.success);
      if (failA.length > 0 || failR.length > 0) {
        toast({
          title: 'Sync completed with errors',
          description: [...failA.map((r: any) => `Account ${r.iAccount}: ${r.message}`), ...failR.map((r: any) => `Rule #${r.iAuthentication}: ${r.message}`)].join('; '),
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Cleanup done', description: `${selectedAccounts.size + selectedAuthRules.size} item(s) removed from Sippy.` });
      }
      setSelectedAccounts(new Set());
      setSelectedAuthRules(new Set());
      refetch();
    },
    onError: (e: any) => toast({ title: 'Cleanup failed', description: e.message, variant: 'destructive' }),
  });

  const toggleAccount  = (id: number) => setSelectedAccounts(s  => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAuthRule = (id: number) => setSelectedAuthRules(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const totalSelected        = selectedAccounts.size + selectedAuthRules.size;
  const orphanedAccounts     = data?.orphanedAccounts     ?? [];
  const orphanedAuthRules    = data?.orphanedAuthRules    ?? [];
  const platformOnlyCompanies = data?.platformOnlyCompanies ?? [];
  const allInSync            = orphanedAccounts.length === 0 && orphanedAuthRules.length === 0 && platformOnlyCompanies.length === 0;

  const TABS: { id: SyncTab; label: string; count?: number; color?: string }[] = [
    { id: 'import',  label: 'Import from Sippy', count: orphanedAccounts.length,     color: orphanedAccounts.length > 0 ? 'text-blue-400' : undefined },
    { id: 'broken',  label: 'Broken Links',      count: platformOnlyCompanies.length, color: platformOnlyCompanies.length > 0 ? 'text-amber-400' : undefined },
    { id: 'cleanup', label: 'Cleanup',            count: orphanedAuthRules.length,    color: orphanedAuthRules.length > 0 ? 'text-rose-400' : undefined },
  ];

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { onClose(); setImportingId(null); setLinkingCompanyId(null); } }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-blue-400" />
            Sippy ↔ Platform Sync
            <Badge variant="outline" className="text-[10px] font-normal ml-1">Admin</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-0 overflow-hidden flex-1 min-h-0">
          {/* Summary cards */}
          {data?.summary && (
            <div className="grid grid-cols-5 gap-2 px-5 pt-3 pb-2">
              {[
                { label: 'In Sippy',        value: data.summary.sippyAccountCount,    color: 'text-blue-400' },
                { label: 'In Platform',     value: data.summary.platformAccountCount, color: 'text-emerald-400' },
                { label: 'Sippy Only',      value: data.summary.orphanedAccountCount,  color: data.summary.orphanedAccountCount  > 0 ? 'text-blue-300'  : 'text-muted-foreground' },
                { label: 'Broken Links',    value: data.summary.platformOnlyCount ?? 0, color: (data.summary.platformOnlyCount ?? 0) > 0 ? 'text-amber-400' : 'text-muted-foreground' },
                { label: 'Orphaned IPs',   value: data.summary.orphanedAuthRuleCount, color: data.summary.orphanedAuthRuleCount > 0 ? 'text-rose-400' : 'text-muted-foreground' },
              ].map(s => (
                <div key={s.label} className="text-center border border-border/40 rounded-lg py-2 px-1">
                  <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-0 px-5 border-b border-border/40">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-xs px-3 py-2 border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === t.id
                    ? 'border-blue-400 text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`text-[10px] font-semibold px-1 rounded ${t.color ?? ''}`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
            {isFetching && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Comparing Sippy ↔ Platform…
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                <XCircle className="h-4 w-4 shrink-0" /> {(error as any).message ?? 'Failed to load sync data'}
              </div>
            )}

            {!isFetching && !error && allInSync && data && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-4 py-4 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Everything is in sync — no mismatches found.
              </div>
            )}

            {/* ── TAB: Import from Sippy ────────────────────────────────── */}
            {tab === 'import' && !isFetching && (
              <>
                {orphanedAccounts.length === 0 && data && (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    All Sippy accounts are tracked in the platform.
                  </p>
                )}
                {orphanedAccounts.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold pb-1">
                      {orphanedAccounts.length} Sippy account{orphanedAccounts.length !== 1 ? 's' : ''} not yet in platform — click "Import" to add them
                    </p>
                    {orphanedAccounts.map(a => (
                      <div key={a.iAccount} className="rounded border border-border/50 bg-muted/20 p-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <Server className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                          <span className="text-xs font-mono font-medium flex-1">{a.username || `i_account:${a.iAccount}`}</span>
                          {a.description && <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{a.description}</span>}
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">#{a.iAccount}</span>
                          {a.blocked && <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-400 border-rose-500/30 shrink-0">blocked</Badge>}
                          {a.balance !== 0 && <span className="text-[10px] text-amber-400 shrink-0">{a.currency} {a.balance}</span>}
                        </div>

                        {importingId === a.iAccount ? (
                          <div className="flex items-center gap-2">
                            <Input
                              data-testid={`input-import-name-${a.iAccount}`}
                              className="h-7 text-xs flex-1"
                              placeholder={`Company name (default: ${a.description || a.username || `Sippy-${a.iAccount}`})`}
                              value={importName}
                              onChange={e => setImportName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') importMutation.mutate({ iAccount: a.iAccount, name: importName }); if (e.key === 'Escape') { setImportingId(null); setImportName(''); } }}
                              autoFocus
                            />
                            <Button
                              data-testid={`btn-confirm-import-${a.iAccount}`}
                              size="sm"
                              className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700"
                              disabled={importMutation.isPending}
                              onClick={() => importMutation.mutate({ iAccount: a.iAccount, name: importName })}
                            >
                              {importMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                              Confirm
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setImportingId(null); setImportName(''); }}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            data-testid={`btn-import-account-${a.iAccount}`}
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                            onClick={() => { setImportingId(a.iAccount); setImportName(a.description || a.username || ''); }}
                          >
                            <PlusCircle className="h-3 w-3" /> Import to Platform
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── TAB: Broken Links ─────────────────────────────────────── */}
            {tab === 'broken' && !isFetching && (
              <>
                {platformOnlyCompanies.length === 0 && data && (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    All provisioned platform companies are confirmed in Sippy.
                  </p>
                )}
                {platformOnlyCompanies.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold pb-1">
                      {platformOnlyCompanies.length} platform compan{platformOnlyCompanies.length !== 1 ? 'ies' : 'y'} whose linked Sippy account no longer exists
                    </p>
                    {platformOnlyCompanies.map(c => (
                      <div key={c.companyId} className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          <span className="text-xs font-semibold flex-1">{c.companyName}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{c.shortCode}</span>
                          <span className="text-[10px] text-amber-400/70 shrink-0">was i_account:{c.sippyIAccount}</span>
                        </div>

                        {linkingCompanyId === c.companyId ? (
                          <div className="flex items-center gap-2">
                            <Input
                              data-testid={`input-link-iaccount-${c.companyId}`}
                              className="h-7 text-xs w-36"
                              placeholder="New i_account #"
                              value={linkIAccount}
                              type="number"
                              onChange={e => setLinkIAccount(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && linkIAccount) linkMutation.mutate({ companyId: c.companyId, iAccount: parseInt(linkIAccount, 10) });
                                if (e.key === 'Escape') { setLinkingCompanyId(null); setLinkIAccount(''); }
                              }}
                              autoFocus
                            />
                            <Button
                              data-testid={`btn-confirm-link-${c.companyId}`}
                              size="sm"
                              className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700"
                              disabled={linkMutation.isPending || !linkIAccount}
                              onClick={() => linkMutation.mutate({ companyId: c.companyId, iAccount: parseInt(linkIAccount, 10) })}
                            >
                              {linkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                              Re-link
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setLinkingCompanyId(null); setLinkIAccount(''); }}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <Button
                              data-testid={`btn-relink-company-${c.companyId}`}
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                              onClick={() => { setLinkingCompanyId(c.companyId); setLinkIAccount(''); }}
                            >
                              <Play className="h-3 w-3" /> Re-link to Sippy Account
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── TAB: Cleanup ──────────────────────────────────────────── */}
            {tab === 'cleanup' && !isFetching && (
              <>
                {orphanedAuthRules.length === 0 && orphanedAccounts.length === 0 && data && (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No orphaned auth rules or untracked accounts to clean up.
                  </p>
                )}

                {/* Untracked accounts (can also delete here) */}
                {orphanedAccounts.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Server className="h-3 w-3 text-rose-400" />
                      Untracked Sippy Accounts ({orphanedAccounts.length})
                      <span className="text-[10px] font-normal normal-case text-muted-foreground/60">select to delete from Sippy</span>
                    </p>
                    <div className="space-y-1">
                      {orphanedAccounts.map(a => (
                        <button
                          key={a.iAccount}
                          data-testid={`sync-account-${a.iAccount}`}
                          onClick={() => toggleAccount(a.iAccount)}
                          className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded border transition-colors ${
                            selectedAccounts.has(a.iAccount)
                              ? 'bg-rose-500/15 border-rose-500/50 text-rose-200'
                              : 'bg-rose-500/5 border-rose-500/20 text-rose-300 hover:bg-rose-500/10'
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            selectedAccounts.has(a.iAccount) ? 'bg-rose-500 border-rose-500' : 'border-rose-500/40'
                          }`}>
                            {selectedAccounts.has(a.iAccount) && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                          </div>
                          <span className="text-xs font-mono font-medium flex-1">{a.username}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">i_account: {a.iAccount}</span>
                          {a.balance !== 0 && <span className="text-[10px] text-amber-400 shrink-0">bal: {a.balance}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Orphaned Auth Rules */}
                {orphanedAuthRules.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <AlertCircle className="h-3 w-3 text-amber-400" />
                      Orphaned Auth Rules ({orphanedAuthRules.length})
                      <span className="text-[10px] font-normal normal-case text-muted-foreground/60">IPs in Sippy not in platform's approved list</span>
                    </p>
                    <div className="space-y-1">
                      {orphanedAuthRules.map(r => (
                        <button
                          key={r.iAuthentication}
                          data-testid={`sync-authrule-${r.iAuthentication}`}
                          onClick={() => toggleAuthRule(r.iAuthentication)}
                          className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded border transition-colors ${
                            selectedAuthRules.has(r.iAuthentication)
                              ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
                              : 'bg-amber-500/5 border-amber-500/20 text-amber-300 hover:bg-amber-500/10'
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            selectedAuthRules.has(r.iAuthentication) ? 'bg-amber-500 border-amber-500' : 'border-amber-500/40'
                          }`}>
                            {selectedAuthRules.has(r.iAuthentication) && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                          </div>
                          <span className="text-xs font-mono flex-1">{r.remoteIp}</span>
                          <span className="text-[10px] text-muted-foreground">→ {r.companyName}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">auth #{r.iAuthentication}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {totalSelected > 0 && (
                  <div className="pt-2 border-t border-border/40">
                    <Button
                      data-testid="btn-execute-sync"
                      size="sm"
                      variant="destructive"
                      disabled={executeMutation.isPending}
                      onClick={() => {
                        const parts = [];
                        if (selectedAccounts.size  > 0) parts.push(`${selectedAccounts.size} Sippy account(s)`);
                        if (selectedAuthRules.size > 0) parts.push(`${selectedAuthRules.size} auth rule(s)`);
                        if (confirm(`Permanently delete ${parts.join(' and ')} from Sippy?\n\nThis cannot be undone.`))
                          executeMutation.mutate();
                      }}
                      className="gap-1.5"
                    >
                      {executeMutation.isPending
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</>
                        : <><Trash2 className="h-3.5 w-3.5" /> Delete {totalSelected} Selected from Sippy</>
                      }
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-5 py-3 border-t border-border/40">
            <Button
              data-testid="btn-refresh-sync"
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReAddAuthButton({ company }: { company: Company }) {
  const { toast } = useToast();
  const addAuthMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${company.id}/add-auth-rules`),
    onSuccess: async (res: any) => {
      let data: any = {};
      try { data = typeof res?.json === 'function' ? await res.json() : res; } catch {}
      const failed = data?.results?.filter((r: any) => !r.success) ?? [];
      const ok     = data?.results?.filter((r: any) =>  r.success) ?? [];
      if (failed.length > 0) {
        toast({
          title: `Auth rules: ${ok.length} OK, ${failed.length} failed`,
          description: failed.map((r: any) => `${r.ip}: ${r.message}`).join('; '),
          variant: "destructive",
        });
      } else {
        toast({ title: `Auth rules pushed — ${ok.length} IP(s) added to Sippy Authentication` });
      }
    },
    onError: (e: any) => toast({ title: "Auth rule push failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Button
      data-testid={`btn-readd-auth-${company.id}`}
      size="sm"
      variant="outline"
      className="w-full h-7 text-xs gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
      disabled={addAuthMutation.isPending}
      onClick={() => addAuthMutation.mutate()}
    >
      {addAuthMutation.isPending
        ? <><Loader2 className="h-3 w-3 animate-spin" /> Pushing IPs…</>
        : <><ShieldPlus className="h-3 w-3" /> Re-add IPs to Sippy Auth</>
      }
    </Button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CompanyListPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [kamFilter, setKamFilter] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const { data, isLoading } = useQuery<{ companies: Company[] }>({
    queryKey: ["/api/companies"],
  });

  const { data: kamsData } = useQuery<{ id: number; name: string; orgRole: string }[]>({
    queryKey: ["/api/kam"],
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/companies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const allCompanies = data?.companies ?? [];

  const companies = allCompanies.filter(c => {
    const matchSearch = !search
      || c.name.toLowerCase().includes(search.toLowerCase())
      || (c.shortCode ?? "").toLowerCase().includes(search.toLowerCase())
      || (c.kam ?? "").toLowerCase().includes(search.toLowerCase());
    const matchKam = !kamFilter || c.kam === kamFilter;
    return matchSearch && matchKam;
  });

  // KAM pills: union of Team & KAM names + any names already used in companies
  const kamNamesFromTeam = (kamsData ?? []).map(k => k.name);
  const kamNamesFromCompanies = allCompanies.map(c => c.kam).filter(Boolean) as string[];
  const allKams = Array.from(new Set([...kamNamesFromTeam, ...kamNamesFromCompanies])).sort();
  const selectedCompany = allCompanies.find(c => c.id === selectedCompanyId) ?? null;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-blue-400" />
          <h1 className="text-xl font-semibold">Companies</h1>
          <Badge variant="outline" className="text-xs">{companies.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="btn-sync-sippy"
            size="sm"
            variant="outline"
            className="gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
            onClick={() => setSyncOpen(true)}
          >
            <RefreshCw className="h-4 w-4" /> Sync
          </Button>
          <Link href="/client-wizard">
            <Button data-testid="btn-client-wizard" size="sm" variant="outline" className="gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
              <Zap className="h-4 w-4" /> Client Wizard
            </Button>
          </Link>
          <Link href="/company/create">
            <Button data-testid="btn-create-company" size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> New Company
            </Button>
          </Link>
        </div>
      </div>

      {/* Search + KAM filter row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            data-testid="input-search-company"
            placeholder="Search by name, code, KAM…"
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* KAM quick-filter pills */}
        {allKams.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">KAM:</span>
            <button
              onClick={() => setKamFilter("")}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                !kamFilter ? "bg-blue-500/20 border-blue-500/40 text-blue-300" : "border-border text-muted-foreground hover:border-border/80"
              }`}
            >
              All
            </button>
            {allKams.map(k => (
              <button
                key={k}
                onClick={() => setKamFilter(k === kamFilter ? "" : k)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  kamFilter === k ? "bg-blue-500/20 border-blue-500/40 text-blue-300" : "border-border text-muted-foreground hover:border-border/80"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-32" />
            </Card>
          ))}
        </div>
      ) : companies.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {search || kamFilter ? "No companies match your filters." : "No companies yet."}
            </p>
            {!search && !kamFilter && (
              <Link href="/company/create">
                <Button size="sm" className="mt-4 gap-1.5">
                  <Plus className="h-4 w-4" /> Create First Company
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map(c => {
            const provStatus = (c as any).provisioningStatus;
            const isProvisioned = provStatus === "provisioned";
            const isSuspended = provStatus === "suspended";
            const showPanel = !isProvisioned && !isSuspended;

            // Products from wizardDraft
            const draft = (c as any).wizardDraft ? (() => { try { return JSON.parse((c as any).wizardDraft); } catch { return null; } })() : null;
            const products: string[] = draft?.selectedProducts ?? [];

            return (
              <Card
                key={c.id}
                data-testid={`card-company-${c.id}`}
                className={`transition-colors ${
                  provStatus === "pending_provision"
                    ? "border-amber-500/30 hover:border-amber-500/50"
                    : isProvisioned
                    ? "border-emerald-500/20 hover:border-emerald-500/40"
                    : "hover:border-border/80"
                }`}
              >
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-start justify-between gap-2">
                    {/* Clickable name area → opens info dialog */}
                    <button
                      data-testid={`btn-open-company-info-${c.id}`}
                      className="min-w-0 text-left group"
                      onClick={() => setSelectedCompanyId(c.id)}
                    >
                      <CardTitle className="text-sm font-semibold truncate group-hover:text-blue-400 transition-colors">
                        {c.name}
                        <ExternalLink className="inline h-3 w-3 ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
                      </CardTitle>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{c.shortCode}</p>
                    </button>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLOR[c.status] ?? ""}`}>
                        {c.status}
                      </Badge>
                      {provStatus === "pending_provision" && (
                        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                          <Clock className="h-2.5 w-2.5 mr-1" />awaiting provision
                        </Badge>
                      )}
                      {isProvisioned && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                          <Zap className="h-2.5 w-2.5 mr-1" />provisioned
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="px-4 pb-4 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={`text-[10px] ${TYPE_COLOR[c.companyType] ?? ""}`}>
                      {c.companyType}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${CONTRACT_COLOR[c.contractType] ?? ""}`}>
                      {c.contractType}
                    </Badge>
                    {products.map(p => (
                      <Badge key={p} variant="outline" className={`text-[10px] ${PRODUCT_COLOR[p] ?? "bg-muted/30 text-muted-foreground"}`}>
                        {p}
                      </Badge>
                    ))}
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    {c.kam && (
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3 w-3 shrink-0" />
                        <button
                          className="truncate hover:text-blue-400 transition-colors text-left"
                          onClick={() => setKamFilter(c.kam === kamFilter ? "" : c.kam!)}
                          title={kamFilter === c.kam ? "Click to clear KAM filter" : `Click to filter by ${c.kam}`}
                        >
                          {c.kam}
                        </button>
                      </div>
                    )}
                    {c.country && (
                      <div className="flex items-center gap-1.5">
                        <Globe className="h-3 w-3 shrink-0" />
                        <span>{c.country}</span>
                      </div>
                    )}
                    {c.currency && (
                      <div className="flex items-center gap-1.5">
                        <CreditCard className="h-3 w-3 shrink-0" />
                        <span>{c.currency} · {c.paymentTerm}</span>
                      </div>
                    )}
                  </div>

                  {showPanel && <ProvisioningPanel company={c} />}

                  {isProvisioned && (c as any).sippyIAccount && <ReAddAuthButton company={c} />}

                  <div className="flex items-center gap-2 pt-1">
                    {!isProvisioned && !draft && (
                      <Link href="/client-wizard">
                        <Button
                          data-testid={`btn-wizard-company-${c.id}`}
                          size="sm" variant="outline"
                          className="h-7 text-xs gap-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        >
                          <Zap className="h-3 w-3" /> Wizard
                        </Button>
                      </Link>
                    )}
                    <Link href={`/company/edit/${c.id}`}>
                      <Button data-testid={`btn-edit-company-${c.id}`} size="sm" variant="outline" className="h-7 text-xs gap-1">
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                    </Link>
                    <Button
                      data-testid={`btn-delete-company-${c.id}`}
                      size="sm" variant="ghost"
                      className="h-7 text-xs gap-1 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                      onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMutation.mutate(c.id); }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Info Dialog */}
      <CompanyInfoDialog
        company={selectedCompany}
        open={selectedCompanyId !== null}
        onClose={() => setSelectedCompanyId(null)}
      />

      {/* Sync Dialog */}
      <SyncDialog open={syncOpen} onClose={() => setSyncOpen(false)} />
    </div>
  );
}
