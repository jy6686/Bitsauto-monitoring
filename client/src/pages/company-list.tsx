import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Building2, Plus, Search, Pencil, Trash2, Users, Globe, CreditCard,
  Zap, Loader2, Clock, CheckCircle2, XCircle, ShieldCheck, AlertTriangle
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

interface IpRequest {
  id: number;
  ipAddress: string;
  trunk: string | null;
  description: string | null;
  status: string;
  submittedBy: string | null;
}

function ProvisioningPanel({ company }: { company: Company }) {
  const { toast } = useToast();
  const companyAny = company as any;

  const { data: ipData, isLoading: ipsLoading } = useQuery<{ requests: IpRequest[] }>({
    queryKey: ["/api/client-ip-requests", company.id],
    queryFn: () => fetch(`/api/client-ip-requests?companyId=${company.id}`, { credentials: "include" }).then(r => r.json()),
    enabled: companyAny.provisioningStatus === "pending_provision",
    refetchInterval: false,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: `${company.name} provisioned to Sippy` });
    },
    onError: (e: any) => toast({ title: "Provisioning failed", description: e.message, variant: "destructive" }),
  });

  const allRequests = ipData?.requests ?? [];
  const pendingIps = allRequests.filter(r => r.status === "pending");
  const approvedIps = allRequests.filter(r => r.status === "approved");
  const rejectedIps = allRequests.filter(r => r.status === "rejected");
  const canProvision = pendingIps.length === 0 && approvedIps.length > 0;

  if (ipsLoading) {
    return (
      <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading IP requests…
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/40 space-y-2">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        IP Approval ({approvedIps.length} approved · {pendingIps.length} pending{rejectedIps.length > 0 ? ` · ${rejectedIps.length} rejected` : ""})
      </p>

      {allRequests.length === 0 && (
        <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          No IP requests found for this company.
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
        </Button>
      )}
    </div>
  );
}

export default function CompanyListPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ companies: Company[] }>({
    queryKey: ["/api/companies"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/companies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const companies = (data?.companies ?? []).filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.shortCode ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.kam ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-blue-400" />
          <h1 className="text-xl font-semibold">Companies</h1>
          <Badge variant="outline" className="text-xs">{companies.length}</Badge>
        </div>
        <Link href="/company/create">
          <Button data-testid="btn-create-company" size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> New Company
          </Button>
        </Link>
      </div>

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
              {search ? "No companies match your search." : "No companies yet."}
            </p>
            {!search && (
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
            return (
              <Card
                key={c.id}
                data-testid={`card-company-${c.id}`}
                className={`transition-colors ${
                  provStatus === "pending_provision"
                    ? "border-amber-500/30 hover:border-amber-500/50"
                    : provStatus === "provisioned"
                    ? "border-emerald-500/20 hover:border-emerald-500/40"
                    : "hover:border-border/80"
                }`}
              >
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-semibold truncate">{c.name}</CardTitle>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{c.shortCode}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLOR[c.status] ?? ""}`}>
                        {c.status}
                      </Badge>
                      {provStatus === "pending_provision" && (
                        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                          <Clock className="h-2.5 w-2.5 mr-1" />awaiting provision
                        </Badge>
                      )}
                      {provStatus === "provisioned" && (
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
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {c.kam && (
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3 w-3 shrink-0" />
                        <span className="truncate">{c.kam}</span>
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

                  {provStatus === "pending_provision" && <ProvisioningPanel company={c} />}

                  {provStatus !== "pending_provision" && (
                    <div className="flex items-center gap-2 pt-1">
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
                  )}

                  {provStatus === "pending_provision" && (
                    <div className="flex items-center gap-2 pt-1">
                      <Link href={`/company/edit/${c.id}`}>
                        <Button data-testid={`btn-edit-company-${c.id}`} size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground">
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
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
