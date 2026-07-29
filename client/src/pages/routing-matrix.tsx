/**
 * routing-matrix.tsx — map each (country × product) cell of a routing package to a Sippy
 * routing group.
 *
 * This is the twelve decisions that replace one dropdown choice per authentication rule,
 * forever. Made once per package, the provisioning engine resolves routing deterministically
 * and never asks an operator again.
 *
 * The mapping is stored by ID. The group name shown here is a cached label — renaming a
 * group in Sippy changes what this page displays, never where calls go. A cell whose cached
 * name no longer matches the routing cache is flagged rather than silently corrected: a
 * renamed group and a deleted group need different responses from an operator.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Route, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PRODUCTS = ["First Class", "Business Class", "Special Bravo", "Special Charlie"] as const;

interface Entry {
  id: number; country: string; product: string; active: boolean;
  i_routing_group: number | null; routing_group_name: string | null;
  liveName: string | null; stale: boolean;
}
interface Group { i_routing_group: number; name: string; members_count: number | null }
interface Matrix {
  package: { id: number; name: string } | null;
  entries: Entry[]; groups: Group[]; unmapped: number;
}
interface PackageRow { id: number; name: string; is_default: boolean; cells: number; unmapped: number }

export default function RoutingMatrixPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [packageId, setPackageId] = useState<number | null>(null);

  const pkgs = useQuery<{ packages: PackageRow[] }>({ queryKey: ["/api/routing-packages"] });
  const active = packageId ?? pkgs.data?.packages?.[0]?.id ?? null;

  const matrix = useQuery<Matrix>({
    queryKey: [`/api/routing-packages/${active}/matrix`],
    enabled: active != null,
  });

  const save = useMutation({
    mutationFn: ({ id, iRoutingGroup }: { id: number; iRoutingGroup: number | null }) =>
      apiRequest("PUT", `/api/routing-package-entries/${id}`, { iRoutingGroup }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/routing-packages/${active}/matrix`] });
      qc.invalidateQueries({ queryKey: ["/api/routing-packages"] });
    },
    onError: (e: any) => toast({
      title: "Mapping not saved", description: e?.message ?? "Unknown error", variant: "destructive",
    }),
  });

  if (pkgs.isLoading) return <div className="p-8 text-slate-400">Loading routing packages…</div>;

  const countries = Array.from(new Set((matrix.data?.entries ?? []).map(e => e.country)));
  const cellFor = (country: string, product: string) =>
    matrix.data?.entries.find(e => e.country === country && e.product === product) ?? null;

  const unmapped = matrix.data?.unmapped ?? 0;
  const stale = (matrix.data?.entries ?? []).filter(e => e.stale).length;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
          <Route className="h-5 w-5" /> Routing Package Matrix
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Which Sippy routing group carries each destination and product. Provisioning reads
          this instead of asking an operator per rule. Stored by group <strong>ID</strong> —
          renaming a group in Sippy will not change where calls go.
        </p>
      </div>

      {(pkgs.data?.packages?.length ?? 0) > 1 && (
        <div className="flex gap-2 flex-wrap">
          {pkgs.data!.packages.map(p => (
            <button key={p.id} onClick={() => setPackageId(p.id)}
              className={cn("rounded-md border px-3 py-1.5 text-sm",
                p.id === active ? "border-slate-400 bg-slate-700/50 text-slate-100"
                                : "border-slate-700 text-slate-400 hover:text-slate-200")}>
              {p.name}
              {p.unmapped > 0 && <span className="ml-2 text-amber-400">{p.unmapped} unmapped</span>}
            </button>
          ))}
        </div>
      )}

      <div className={cn("rounded-lg border p-4 flex items-start gap-3",
        unmapped > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5")}>
        {unmapped > 0
          ? <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          : <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />}
        <div className="text-sm">
          {unmapped > 0 ? (
            <>
              <div className="text-amber-400 font-medium">{unmapped} cell{unmapped !== 1 && "s"} unmapped</div>
              <div className="text-slate-400 mt-0.5">
                Provisioning cannot create authentication rules for an unmapped cell — a rule with
                no routing group authenticates the caller and then falls back to the account
                default, which is the usual cause of “No Route Found”.
              </div>
            </>
          ) : (
            <div className="text-emerald-400 font-medium">Every cell mapped — provisioning can resolve routing for this package.</div>
          )}
          {stale > 0 && (
            <div className="text-amber-400 mt-2 flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              {stale} mapping{stale !== 1 && "s"} reference a group that was renamed or removed in Sippy.
            </div>
          )}
        </div>
      </div>

      {matrix.isLoading ? (
        <div className="text-slate-400">Loading matrix…</div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-800/60 text-slate-400 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-2">Destination</th>
                {PRODUCTS.map(p => <th key={p} className="text-left font-medium px-4 py-2">{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {countries.map(country => (
                <tr key={country} className="border-t border-slate-800">
                  <td className="px-4 py-2 text-slate-200 font-medium whitespace-nowrap">{country}</td>
                  {PRODUCTS.map(product => {
                    const cell = cellFor(country, product);
                    if (!cell) return <td key={product} className="px-4 py-2 text-slate-600">—</td>;
                    return (
                      <td key={product} className="px-4 py-2">
                        <select
                          className={cn(
                            "w-full rounded border bg-slate-900/60 px-2 py-1.5 text-sm",
                            cell.stale ? "border-amber-500/50 text-amber-300"
                            : cell.i_routing_group == null ? "border-amber-500/40 text-slate-400"
                            : "border-slate-700 text-slate-200",
                          )}
                          value={cell.i_routing_group ?? ""}
                          disabled={save.isPending}
                          onChange={e => save.mutate({
                            id: cell.id,
                            iRoutingGroup: e.target.value === "" ? null : Number(e.target.value),
                          })}
                        >
                          <option value="">— not mapped —</option>
                          {(matrix.data?.groups ?? []).map(g => (
                            <option key={g.i_routing_group} value={g.i_routing_group}>
                              {g.name} (#{g.i_routing_group})
                            </option>
                          ))}
                        </select>
                        {cell.stale && (
                          <div className="text-[11px] text-amber-400 mt-1">
                            saved as “{cell.routing_group_name ?? "—"}”, cache says{" "}
                            {cell.liveName ? `“${cell.liveName}”` : "the group is gone"}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Groups listed come from the routing cache, synced from Sippy every 15 minutes. If a group
        you just created is missing, run <strong>Sync Now</strong> on Routing Manager first —
        a group absent from the cache is rejected rather than saved blind.
      </p>
    </div>
  );
}
