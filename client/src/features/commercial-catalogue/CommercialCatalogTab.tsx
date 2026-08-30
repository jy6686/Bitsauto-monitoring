/**
 * The catalogue as it is SOLD: Country › Type › Operator.
 *
 * The page this replaces rendered one row per prefix — 19,160 of them — so "Afghanistan
 * Mobile" appeared six times, once per dial code, and the thing an account manager actually
 * sells was never a row at all. The hierarchy is derived server-side by buildHierarchy() and
 * shared with the Send Rate picker, so the tree you approve on and the tree you sell from
 * cannot disagree.
 *
 * Prefixes are counted here, never listed. They are transport detail. A destination's actual
 * digits are fetched only when someone opens Technical details on that one destination,
 * which means the operational payload does not carry them at all.
 *
 * Nothing here is country-specific: 244 countries, one code path.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Search, ChevronRight, ChevronDown, Check, X, Globe,
  CheckCircle2, Clock, ShieldOff, Loader2, AlertTriangle,
} from "lucide-react";

type Leaf = {
  id: number;
  name: string;            // supplier name, byte-for-byte — the identity
  label: string;           // what to render
  prefixCount: number;
  approvalStatus?: string;
};
type TypeNode = {
  type: string;
  destinationId: number | null;
  prefixCount: number;
  approvalStatus?: string;
  operators: Leaf[];
};
type CountryNode = { country: string; types: TypeNode[] };
type TreeResponse = {
  versionId: number;
  totals: { destinations: number; prefixes: number; approved: number; unapproved: number; blocked: number };
  countries: CountryNode[];
};
type Catalogue = { id: number; label: string; status: string; destinations: string | number };

const STATUS_STYLE: Record<string, { cls: string; Icon: typeof Check; text: string }> = {
  approved:   { cls: "text-green-400",  Icon: CheckCircle2, text: "Approved" },
  unapproved: { cls: "text-amber-400",  Icon: Clock,        text: "Unapproved" },
  blocked:    { cls: "text-red-400",    Icon: ShieldOff,    text: "Blocked" },
};

function StatusPill({ status }: { status?: string }) {
  const s = STATUS_STYLE[status ?? ""] ?? STATUS_STYLE.unapproved;
  const { Icon } = s;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium", s.cls)}>
      <Icon className="w-3 h-3" />{s.text}
    </span>
  );
}

/** The digits, on demand. Deliberately a separate request: the tree never carries them. */
function TechnicalDetails({ destinationId }: { destinationId: number }) {
  // { destination, prefixes, history } — prefixes are a sibling of destination, not a field on it.
  const { data, isLoading } = useQuery<{ prefixes?: Array<{ prefix: string }> }>({
    queryKey: [`/api/commercial/destinations/${destinationId}`],
    queryFn: () => fetch(`/api/commercial/destinations/${destinationId}`).then(r => r.json()),
  });
  if (isLoading) return <div className="text-[10px] text-muted-foreground py-1">Loading prefixes…</div>;
  const prefixes = data?.prefixes ?? [];
  if (!prefixes.length) return <div className="text-[10px] text-muted-foreground py-1">No prefixes recorded.</div>;
  return (
    <div className="py-1">
      <div className="text-[10px] text-muted-foreground mb-1">
        Prefixes ({prefixes.length}) — backend routing data, not shown in operational screens
      </div>
      <div className="flex flex-wrap gap-1">
        {prefixes.map(p => (
          <span key={p.prefix} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-foreground/70">
            {p.prefix}
          </span>
        ))}
      </div>
    </div>
  );
}

function DestinationRow({
  leaf, indent, onSetStatus, pendingId,
}: {
  leaf: Leaf; indent: boolean;
  onSetStatus: (id: number, status: string) => void;
  pendingId: number | null;
}) {
  const [showTech, setShowTech] = useState(false);
  const busy = pendingId === leaf.id;
  const approved = leaf.approvalStatus === "approved";

  return (
    <div className={cn("border-b border-border/20 last:border-0", indent && "pl-6")}>
      <div className="flex items-center gap-3 py-2 pr-3 hover:bg-muted/5">
        <div className="flex-1 min-w-0">
          {/* The supplier name is the identity and is never rewritten for display. */}
          <div className="text-xs text-foreground/85 truncate">{leaf.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusPill status={leaf.approvalStatus} />
            <button
              onClick={() => setShowTech(v => !v)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {showTech ? "Hide" : "Technical details"} · {leaf.prefixCount} prefix{leaf.prefixCount === 1 ? "" : "es"}
            </button>
          </div>
          {showTech && <TechnicalDetails destinationId={leaf.id} />}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : approved ? (
            <button
              onClick={() => onSetStatus(leaf.id, "unapproved")}
              className="text-[10px] px-2 py-1 rounded border border-border/50 text-muted-foreground hover:text-amber-400 hover:border-amber-400/40 transition-colors"
              title="Remove from the sellable catalogue"
            >
              <X className="w-3 h-3 inline mr-1" />Unapprove
            </button>
          ) : (
            <button
              onClick={() => onSetStatus(leaf.id, "approved")}
              className="text-[10px] px-2 py-1 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors"
              title="Make sellable — appears in Send Rate immediately"
            >
              <Check className="w-3 h-3 inline mr-1" />Approve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CommercialCatalogTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [openCountry, setOpenCountry] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  // The ACTIVE version, not "the newest". Exactly one is active by construction, and the
  // catalogue page must show what is live rather than whatever was imported most recently.
  const { data: catalogues } = useQuery<{ catalogues: Catalogue[] }>({
    queryKey: ["/api/commercial/catalogues"],
    queryFn: () => fetch("/api/commercial/catalogues").then(r => r.json()),
  });
  const active = catalogues?.catalogues?.find(c => c.status === "active") ?? null;

  const { data: tree, isLoading, error } = useQuery<TreeResponse>({
    queryKey: [`/api/commercial/catalogues/${active?.id}/tree`],
    queryFn: () => fetch(`/api/commercial/catalogues/${active!.id}/tree`).then(r => r.json()),
    enabled: !!active,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      setPendingId(id);
      const r = await apiRequest("POST", `/api/commercial/destinations/${id}/approval`, { status });
      return r.json();
    },
    onSuccess: (_d, v) => {
      // Both trees move together — approving here is what makes it sellable there.
      qc.invalidateQueries({ queryKey: [`/api/commercial/catalogues/${active?.id}/tree`] });
      qc.invalidateQueries({ queryKey: ["/api/commercial/picker"] });
      qc.invalidateQueries({ queryKey: ["/api/commercial/catalogues"] });
      toast({ title: v.status === "approved" ? "Approved — now sellable in Send Rate" : "Unapproved — removed from Send Rate" });
    },
    onError: (e: any) => toast({ title: "Could not change approval", description: e.message, variant: "destructive" }),
    onSettled: () => setPendingId(null),
  });
  const onSetStatus = (id: number, status: string) => setStatus.mutate({ id, status });

  // Search matches a country, a type, or an operator — one box, because an account manager
  // looking for "Zong" should not have to know it lives under Pakistan › Mobile.
  const countries = useMemo(() => {
    const all = tree?.countries ?? [];
    const q = query.trim().toUpperCase();
    if (!q) return all;
    return all
      .map(c => {
        if (c.country.toUpperCase().includes(q)) return c;
        const types = c.types
          .map(t => {
            if (t.type.toUpperCase().includes(q)) return t;
            const operators = t.operators.filter(o => o.name.toUpperCase().includes(q));
            return operators.length ? { ...t, operators } : null;
          })
          .filter(Boolean) as TypeNode[];
        return types.length ? { ...c, types } : null;
      })
      .filter(Boolean) as CountryNode[];
  }, [tree, query]);

  if (!catalogues) {
    return <div className="p-6 text-xs text-muted-foreground">Loading catalogue…</div>;
  }
  if (!active) {
    return (
      <div className="p-6">
        <div className="flex items-start gap-2 text-xs text-amber-400 border border-amber-500/30 rounded-lg p-3 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">No active catalogue version</div>
            <div className="text-muted-foreground mt-1">
              A version must be activated before destinations can be approved or sold. Import a
              catalogue, then activate it.
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="p-6 text-xs text-red-400">Could not load the catalogue tree: {String((error as any).message)}</div>;
  }

  const t = tree?.totals;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              Commercial Catalogue
              <span className="text-[10px] text-muted-foreground font-normal">{active.label}</span>
            </h2>
            {t && (
              <div className="text-[10px] text-muted-foreground mt-1">
                {countries.length} countr{countries.length === 1 ? "y" : "ies"} ·{" "}
                {t.destinations.toLocaleString()} destinations ·{" "}
                <span className="text-green-400">{t.approved.toLocaleString()} approved</span> ·{" "}
                <span className="text-amber-400">{t.unapproved.toLocaleString()} unapproved</span>
                {t.blocked > 0 && <> · <span className="text-red-400">{t.blocked.toLocaleString()} blocked</span></>}
                {" "}· {t.prefixes.toLocaleString()} prefixes behind them
              </div>
            )}
          </div>
          <div className="relative w-64 flex-shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Country, type or operator…"
              className="w-full bg-muted/30 border border-border/50 rounded pl-8 pr-2 py-1.5 text-xs"
              data-testid="input-catalogue-search"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-xs text-muted-foreground py-8 text-center">Building the hierarchy…</div>
        ) : countries.length === 0 ? (
          <div className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border/40 rounded-lg">
            Nothing matches “{query}”.
          </div>
        ) : (
          <div className="border border-border/50 rounded-lg overflow-hidden">
            {countries.map(c => {
              // A search narrows to what matched, so leaving everything shut would hide the answer.
              const open = openCountry === c.country || (!!query.trim() && countries.length <= 8);
              const dests = c.types.reduce((a, ty) => a + ty.operators.length + (ty.destinationId ? 1 : 0), 0);
              return (
                <div key={c.country} className="border-b border-border/30 last:border-0">
                  <button
                    onClick={() => setOpenCountry(open && openCountry === c.country ? null : c.country)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/10 text-left"
                  >
                    {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="text-xs font-medium text-foreground/90 flex-1">{c.country}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {c.types.length} type{c.types.length === 1 ? "" : "s"} · {dests} destination{dests === 1 ? "" : "s"}
                    </span>
                  </button>

                  {open && (
                    <div className="bg-muted/[0.03]">
                      {c.types.map(ty => (
                        <div key={ty.type} className="border-t border-border/20">
                          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/80 bg-muted/10">
                            {ty.type}
                          </div>
                          {/* The type node itself is sellable when the supplier sells it —
                              INDIA - MOBILE has no operator level. */}
                          {ty.destinationId !== null && (
                            <DestinationRow
                              leaf={{ id: ty.destinationId, name: `${c.country} - ${ty.type}`, label: ty.type,
                                      prefixCount: ty.prefixCount, approvalStatus: ty.approvalStatus }}
                              indent={false} onSetStatus={onSetStatus} pendingId={pendingId}
                            />
                          )}
                          {ty.operators.map(op => (
                            <DestinationRow key={op.id} leaf={op} indent onSetStatus={onSetStatus} pendingId={pendingId} />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
