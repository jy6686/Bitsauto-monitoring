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
} from "lucide-react";
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
      if (authErrors.length > 0) {
        toast({
          title: `${company.name} provisioned — IP auth failed`,
          description: `Auth rule error(s): ${authErrors.join('; ')}${spNote ? '\n' + spNote : ''}`,
          variant: "destructive",
        });
      } else if (spNote) {
        toast({
          title: `${company.name} provisioned to Sippy`,
          description: spNote,
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
    </div>
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
    </div>
  );
}
