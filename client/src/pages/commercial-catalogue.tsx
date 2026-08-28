/**
 * Commercial Catalogue — the pricing team's review console.
 *
 * Its own route rather than a tab inside Destination Catalog, because the two are different
 * systems: this reads the versioned supplier catalogue (1,344 identities), that one reads the
 * 150k-row routing catalogue. Sharing a page would make "which catalogue am I looking at"
 * a question the operator has to keep answering.
 *
 * There is no edit affordance anywhere, and that is deliberate rather than unfinished.
 * Supplier data is immutable at the database level — names, prefixes, rates, increments and
 * effective dates are refused on UPDATE — so a correction means importing a new version. The
 * only three actions that exist are approve, block, and activate.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, CheckCircle2, XCircle, Clock, History, Layers, Rocket, Loader2, ShieldCheck, Hash,
} from "lucide-react";

type Catalogue = {
  id: number; label: string; status: string; source_file: string | null;
  created_at: string; activated_at: string | null; activated_by: string | null;
  destinations: string; prefixes: string; approved: string; pending: string; blocked: string;
  file_sha256: string | null; imported_at: string | null;
};
type DestRow = {
  id: number; name: string; approval_status: string; approved_by: string | null; approved_at: string | null;
  prefix_count: string; prefix_preview: string[] | null;
  supplier_rate: string | null; billing_increment: string | null; effective_date: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  approved:   "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  unapproved: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  blocked:    "bg-rose-500/10 text-rose-600 border-rose-500/30",
  draft:      "bg-slate-500/10 text-slate-600 border-slate-500/30",
  active:     "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  archived:   "bg-slate-500/10 text-slate-500 border-slate-500/30",
};
const n = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString();
/** The supplier convention is "COUNTRY - TYPE OPERATOR"; the country is what precedes " - ". */
const countryOf = (name: string) => (name.includes(" - ") ? name.split(" - ")[0].trim() : name);

export default function CommercialCataloguePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [versionId, setVersionId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: cats } = useQuery<{ catalogues: Catalogue[] }>({ queryKey: ["/api/commercial/catalogues"] });
  const catalogues = cats?.catalogues ?? [];
  const version = useMemo(
    () => catalogues.find(c => c.id === versionId) ?? catalogues[0] ?? null,
    [catalogues, versionId],
  );

  const listUrl = version
    ? `/api/commercial/catalogues/${version.id}/destinations?limit=300` +
      (q ? `&q=${encodeURIComponent(q)}` : "") + (status ? `&status=${status}` : "")
    : null;
  const { data: list, isFetching } = useQuery<{ total: number; destinations: DestRow[] }>({
    queryKey: [listUrl], enabled: !!listUrl,
  });
  const rows = list?.destinations ?? [];

  const { data: detail } = useQuery<{ destination: any; prefixes: any[]; history: any[] }>({
    queryKey: [`/api/commercial/destinations/${selectedId}`], enabled: !!selectedId,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["/api/commercial/catalogues"] });
    if (listUrl) qc.invalidateQueries({ queryKey: [listUrl] });
    if (selectedId) qc.invalidateQueries({ queryKey: [`/api/commercial/destinations/${selectedId}`] });
  };

  const setApproval = useMutation({
    mutationFn: async (v: { id: number; status: string; reason?: string }) =>
      (await apiRequest("POST", `/api/commercial/destinations/${v.id}/approval`, { status: v.status, reason: v.reason })).json(),
    onSuccess: (_d, v) => { refresh(); toast({ title: `Marked ${v.status}` }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const bulk = useMutation({
    mutationFn: async (v: { namePrefix: string; status: string; reason?: string }) =>
      (await apiRequest("POST", `/api/commercial/catalogues/${version!.id}/approvals/bulk`, v)).json(),
    onSuccess: (d: any) => { refresh(); toast({ title: `${d.matched} destination(s) ${d.status}` }); },
    onError: (e: any) => toast({ title: "Bulk action failed", description: e.message, variant: "destructive" }),
  });

  const activate = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/commercial/catalogues/${version!.id}/activate`)).json(),
    onSuccess: (d: any) => {
      refresh();
      toast({ title: d.result, description: `${n(d.sellable)} destination(s) now sellable · ${n(d.stillPending)} still pending and hidden` });
    },
    onError: (e: any) => toast({ title: "Activation failed", description: e.message, variant: "destructive" }),
  });

  // Offered from the selected row, so the country is one the reviewer is already looking at
  // rather than typed from memory. The endpoint refuses an empty prefix regardless.
  const selectedCountry = detail?.destination ? countryOf(detail.destination.name) : null;
  const countryCount = selectedCountry ? rows.filter(r => countryOf(r.name) === selectedCountry).length : 0;

  if (!version) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No catalogue imported yet. Load one with <code className="font-mono">scripts/import-supplier-catalogue.ts</code>.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Version header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-border/60 px-6 py-4 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <Layers className="w-5 h-5 text-muted-foreground" />
          <Select value={String(version.id)} onValueChange={v => { setVersionId(Number(v)); setSelectedId(null); }}>
            <SelectTrigger className="w-[260px]" data-testid="version-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalogues.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{c.label} — {c.status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className={cn("uppercase text-[10px]", STATUS_STYLE[version.status])}>
            {version.status}
          </Badge>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <Stat label="Destinations" value={n(version.destinations)} />
          <Stat label="Prefixes"     value={n(version.prefixes)} />
          <Stat label="Approved"     value={n(version.approved)} tone="text-emerald-600" />
          <Stat label="Pending"      value={n(version.pending)}  tone="text-amber-600" />
          {Number(version.blocked) > 0 && <Stat label="Blocked" value={n(version.blocked)} tone="text-rose-600" />}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {version.file_sha256 && (
            <span className="text-[11px] font-mono text-muted-foreground" title="SHA-256 of the imported workbook">
              <Hash className="w-3 h-3 inline mr-1" />{version.file_sha256.slice(0, 16)}…
            </span>
          )}
          {version.status !== "active" && (
            <Button size="sm" onClick={() => activate.mutate()} disabled={activate.isPending} data-testid="activate-version">
              {activate.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
              Activate
            </Button>
          )}
        </div>
      </div>

      {/* Activation is the only irreversible-looking action here, so say what it does. */}
      {version.status !== "active" && (
        <div className="px-6 py-2 text-[12px] text-muted-foreground border-b border-border/40 bg-muted/30">
          <ShieldCheck className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          Nothing in this version reaches Rate Manager, Send Rate or Notifications while it is <b>{version.status}</b>.
          Approving a destination does not publish it — activating the version does, and only for rows already approved.
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* ── List ─────────────────────────────────────────────────────────────── */}
        <div className="w-[440px] border-r border-border/60 flex flex-col min-h-0">
          <div className="p-3 space-y-2 border-b border-border/40">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                value={q} onChange={e => setQ(e.target.value)} className="pl-8"
                placeholder="Name or prefix — e.g. pakistan mobile, or 9232"
                data-testid="catalogue-search"
              />
            </div>
            <Select value={status || "all"} onValueChange={v => setStatus(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="unapproved">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-[11px] text-muted-foreground flex items-center gap-2">
              {isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {n(list?.total)} matching{(list?.total ?? 0) > rows.length && ` · showing first ${rows.length}`}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {rows.map(r => (
              <button
                key={r.id} onClick={() => setSelectedId(r.id)}
                className={cn("w-full text-left px-3 py-2 border-b border-border/30 hover:bg-muted/50",
                              selectedId === r.id && "bg-muted")}
                data-testid={`dest-${r.id}`}
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={r.approval_status} />
                  <span className="text-sm font-medium truncate">{r.name}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                    {n(r.prefix_count)} {Number(r.prefix_count) === 1 ? "code" : "codes"}
                  </span>
                </div>
                {/* Prefix preview, so approving a 1,757-code destination is an informed decision. */}
                {r.prefix_preview?.length ? (
                  <div className="pl-4 text-[11px] font-mono text-muted-foreground/70 truncate">
                    {r.prefix_preview.join(", ")}
                    {Number(r.prefix_count) > r.prefix_preview.length &&
                      ` +${n(Number(r.prefix_count) - r.prefix_preview.length)} more`}
                  </div>
                ) : (
                  <div className="pl-4 text-[11px] text-rose-500/80">no prefix — not sellable</div>
                )}
              </button>
            ))}
            {!rows.length && !isFetching && (
              <div className="p-6 text-sm text-muted-foreground">
                Nothing matches. Supplier names carry a separator — try <b>pakistan mobile</b> rather than
                the exact phrase, or search a prefix such as <b>9232</b>.
              </div>
            )}
          </div>
        </div>

        {/* ── Detail ───────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {!detail?.destination ? (
            <div className="p-8 text-sm text-muted-foreground">Select a destination to review it.</div>
          ) : (
            <div className="p-6 space-y-6">
              <div className="flex items-start gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{detail.destination.name}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {detail.destination.version_label} · {detail.prefixes.length}{" "}
                    {detail.prefixes.length === 1 ? "prefix" : "prefixes"}
                    {detail.destination.approved_by && <> · approved by {detail.destination.approved_by}</>}
                  </p>
                </div>
                <Badge variant="outline" className={cn("uppercase text-[10px]", STATUS_STYLE[detail.destination.approval_status])}>
                  {detail.destination.approval_status}
                </Badge>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" disabled={setApproval.isPending}
                    onClick={() => setApproval.mutate({ id: detail.destination.id, status: "approved" })}
                    data-testid="approve-one">
                    <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-600" />Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={setApproval.isPending}
                    onClick={() => {
                      const reason = window.prompt("Reason for blocking this destination?");
                      if (reason) setApproval.mutate({ id: detail.destination.id, status: "blocked", reason });
                    }}
                    data-testid="block-one">
                    <XCircle className="w-4 h-4 mr-1.5 text-rose-600" />Block
                  </Button>
                </div>
              </div>

              {selectedCountry && countryCount > 1 && (
                <div className="rounded border border-border/60 bg-muted/30 p-3 flex items-center gap-3">
                  <span className="text-sm">
                    <b>{selectedCountry}</b> has {countryCount} destination(s) in this view.
                  </span>
                  <Button size="sm" variant="outline" className="ml-auto" disabled={bulk.isPending}
                    onClick={() => bulk.mutate({ namePrefix: selectedCountry, status: "approved" })}
                    data-testid="approve-country">
                    {bulk.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
                    Approve all of {selectedCountry}
                  </Button>
                </div>
              )}

              <Section title="Prefixes" subtitle="Supplied by the vendor. Not editable — a correction is a new catalogue version.">
                <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-6 gap-y-1 text-sm">
                  <div className="contents text-[11px] uppercase text-muted-foreground">
                    <div>Prefix</div><div>Rate</div><div>Increment</div><div>Effective</div>
                  </div>
                  {detail.prefixes.map((p: any) => (
                    <div key={p.prefix} className="contents">
                      <div className="font-mono">{p.prefix}</div>
                      <div>{p.supplier_rate ? `$${Number(p.supplier_rate).toFixed(4)}` : "—"}</div>
                      <div className="text-muted-foreground">{p.billing_increment ?? "—"}</div>
                      <div className="text-muted-foreground">{p.effective_date_raw ?? "—"}</div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Approval history" subtitle="Every transition, including un-approvals.">
                {detail.history.length ? (
                  <ul className="space-y-2">
                    {detail.history.map((h: any, i: number) => (
                      <li key={i} className="flex items-center gap-3 text-sm">
                        <History className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">{h.from_status}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium">{h.to_status}</span>
                        <span className="text-muted-foreground">by {h.actor ?? "system"}</span>
                        {h.reason && <span className="text-muted-foreground italic">— {h.reason}</span>}
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {new Date(h.changed_at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5" />Imported, never reviewed.
                  </p>
                )}
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className={cn("font-semibold tabular-nums", tone)}>{value}</div>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
    </div>
  );
}
function StatusDot({ status }: { status: string }) {
  const tone = status === "approved" ? "bg-emerald-500" : status === "blocked" ? "bg-rose-500" : "bg-amber-500";
  return <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", tone)} />;
}
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="text-[11px] text-muted-foreground mb-2">{subtitle}</p>}
      {children}
    </div>
  );
}
