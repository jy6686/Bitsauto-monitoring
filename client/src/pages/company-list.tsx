import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Plus, Search, Pencil, Trash2, Users, Globe, CreditCard } from "lucide-react";
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
          {companies.map(c => (
            <Card key={c.id} data-testid={`card-company-${c.id}`} className="hover:border-border/80 transition-colors">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm font-semibold truncate">{c.name}</CardTitle>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{c.shortCode}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${STATUS_COLOR[c.status] ?? ""}`}>
                    {c.status}
                  </Badge>
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
