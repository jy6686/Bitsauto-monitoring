import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ChevronDown, Search, X, RefreshCw, Check, AlertTriangle, Send,
  BarChart2, Eye, Clock, ChevronRight, Loader2, CircleCheck, CircleX,
  Plus, Trash2, Bell, BellRing, TrendingUp, TrendingDown, Lightbulb,
  PackageCheck, Tag, Calendar, ShieldAlert, ExternalLink,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Product {
  id: number; code: string; name: string;
  trunkPrefix: string | null; status: string; color: string;
}
interface SippyAccount { iAccount: number; username: string; balance: number; cached?: boolean; tariffName?: string | null; }
interface DestNode {
  id: number; parentId: number | null; level: number; name: string;
  countryCode: string | null; dialPrefix: string | null; commercialStatus: string;
}
interface RateEntry {
  iRate: number; prefix: string; price1: number | null;
  activationDate: string | null; expirationDate: string | null; forbidden: boolean | null;
}

// ── MultiSelect Dropdown ───────────────────────────────────────────────────────
function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Leave blank for all",
  searchable = true,
  maxHeight = "h-48",
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
  maxHeight?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = searchable
    ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  const display =
    value.length === 0 ? placeholder
    : value.length === options.length ? "All selected"
    : `${value.length} of ${options.length} selected`;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2 py-1 text-xs border border-border/60 rounded bg-background hover:bg-muted/50 text-left"
        data-testid="multiselect-trigger"
      >
        <span className="truncate text-foreground/80">{display}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground ml-1" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-popover border border-border rounded shadow-xl mt-px flex flex-col" style={{ minWidth: "180px" }}>
          {searchable && (
            <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
              <Search className="w-3 h-3 text-muted-foreground shrink-0" />
              <input
                className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/60"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search..."
                autoFocus
              />
              {q && (
                <button onClick={() => setQ("")}>
                  <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 px-2 py-1 border-b border-border/40 bg-muted/20">
            <button
              className="text-[10px] text-muted-foreground hover:text-primary"
              onClick={() => onChange(options.map(o => o.value))}
            >✓ Check all</button>
            <span className="text-border">|</span>
            <button className="text-[10px] text-muted-foreground hover:text-primary" onClick={() => onChange([])}>
              Uncheck all
            </button>
          </div>
          <div className={cn("overflow-y-auto", maxHeight)}>
            {filtered.map(o => {
              const checked = value.includes(o.value);
              return (
                <label
                  key={o.value}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 cursor-pointer text-xs hover:bg-accent/40",
                    checked && "text-primary",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.value)}
                    className="w-3 h-3 accent-primary"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-3">No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Toggle Buttons ─────────────────────────────────────────────────────────────
function ToggleButtons({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded overflow-hidden border border-border/60">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "flex-1 px-2 py-1 text-[10px] font-medium transition-colors",
            value === opt
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-muted/40",
          )}
          data-testid={`toggle-${opt.toLowerCase()}`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ── Sidebar Section ────────────────────────────────────────────────────────────
function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 pb-0.5 border-b border-border/30">
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Rate Detail Panel ─────────────────────────────────────────────────────────
function RateDetailPanel({
  account,
  trunkPrefix,
  allDests,
  selectedCountries,
  selectedOperators,
  selectedCategories,
  selectedDetails,
  onClose,
}: {
  account: SippyAccount;
  trunkPrefix: string;
  allDests: DestNode[];
  selectedCountries: string[];
  selectedOperators: string[];
  selectedCategories: string[];
  selectedDetails: string[];
  onClose: () => void;
}) {
  const { data: acctInfo, isLoading: infoLoading } = useQuery<{
    iAccount: number; username: string; iTariff: number | null;
  }>({
    queryKey: [`/api/sippy/accounts/${account.iAccount}/info`],
    enabled: !!account.iAccount,
  });

  const iTariff = acctInfo?.iTariff;

  const { data: tariffData, isLoading: ratesLoading } = useQuery<RateEntry[]>({
    queryKey: [`/api/sippy/tariffs/${iTariff}/rates?limit=500`],
    enabled: !!iTariff,
  });

  // Determine which destination filter (if any) is active, deepest level wins
  const activeDestIds = selectedDetails.length > 0 ? selectedDetails
    : selectedCategories.length > 0 ? selectedCategories
    : selectedOperators.length > 0 ? selectedOperators
    : selectedCountries.length > 0 ? selectedCountries
    : [];
  // Walk the tree to collect every dialPrefix under the active selection (any level)
  const allowedPrefixes = useMemo(() => {
    if (activeDestIds.length === 0) return null; // null = no destination filter, show all
    const idSet = new Set(activeDestIds.map(Number));
    const collect = (nodeId: number, acc: Set<string>) => {
      const node = allDests.find(d => d.id === nodeId);
      if (node?.dialPrefix) acc.add(node.dialPrefix);
      allDests.filter(d => d.parentId === nodeId).forEach(child => collect(child.id, acc));
    };
    const acc = new Set<string>();
    idSet.forEach(id => collect(id, acc));
    return acc;
  }, [activeDestIds, allDests]);
  const rates = useMemo(() => {
    if (!tariffData || !Array.isArray(tariffData)) return [];
    let filtered = trunkPrefix
      ? tariffData.filter(r => String(r.prefix ?? "").startsWith(trunkPrefix))
      : tariffData;
    if (allowedPrefixes) {
      filtered = filtered.filter(r => {
        const rawPrefix = trunkPrefix ? String(r.prefix).slice(trunkPrefix.length) : String(r.prefix ?? "");
        return Array.from(allowedPrefixes).some(p => rawPrefix.startsWith(p) || p.startsWith(rawPrefix));
      });
    }
    return filtered.map(r => {
      const rawPrefix = trunkPrefix
        ? String(r.prefix).slice(trunkPrefix.length)
        : String(r.prefix ?? "");
      const dest = allDests.find(d => d.dialPrefix && (d.dialPrefix === rawPrefix || d.dialPrefix === r.prefix));
      return { ...r, rawPrefix, destName: dest?.name ?? rawPrefix };
    });
  }, [tariffData, trunkPrefix, allDests, allowedPrefixes]);

  const isLoading = infoLoading || ratesLoading;
  const [selectedRateKeys, setSelectedRateKeys] = useState<Set<string>>(new Set());
  const [changeModalOpen, setChangeModalOpen] = useState(false);
  const rateKey = (r: RateEntry & { rawPrefix?: string }, i: number) => String(r.iRate ?? `${r.prefix}-${i}`);
  const allSelected = rates.length > 0 && rates.every((r, i) => selectedRateKeys.has(rateKey(r, i)));
  const toggleAll = () => {
    if (allSelected) setSelectedRateKeys(new Set());
    else setSelectedRateKeys(new Set(rates.map((r, i) => rateKey(r, i))));
  };
  const toggleOne = (key: string) => {
    setSelectedRateKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const selectedRates = rates.filter((r, i) => selectedRateKeys.has(rateKey(r, i)));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm font-semibold">{account.username}</span>
          {iTariff && (
            <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
              Tariff #{iTariff}
            </span>
          )}
          {trunkPrefix && (
            <span className="text-[10px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded font-mono">
              Prefix: {trunkPrefix}xxxxx
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-0.5 rounded"
          data-testid="close-rate-detail"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground text-xs">
          <Loader2 className="w-4 h-4 animate-spin" />
          {infoLoading ? "Looking up account tariff…" : `Loading rates for Tariff #${iTariff}…`}
        </div>
      ) : !iTariff ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs text-center p-4">
          <div>
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-400" />
            No tariff linked to this account on Sippy.
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-muted/10 flex-shrink-0">
            <span className="text-[11px] text-muted-foreground">
              {selectedRateKeys.size > 0 ? `${selectedRateKeys.size} selected` : "Select rates to change"}
            </span>
            <button
              onClick={() => setChangeModalOpen(true)}
              disabled={selectedRateKeys.size === 0}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded px-3 py-1.5 font-medium"
              data-testid="btn-change-client-rates"
            >
              Change Client Rates
            </button>
          </div>
          <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-muted/30 backdrop-blur z-10">
              <tr>
                <th className="text-left py-2 px-3 border-b border-border w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} data-testid="checkbox-select-all" />
                </th>
                {["Code", "Destination", "Sippy Prefix", "Rate (USD)", "Active From", "Active Till", "Status"].map(h => (
                  <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground border-b border-border whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => (
                <tr
                  key={r.iRate ?? i}
                  className={cn(
                    "border-b border-border/30 hover:bg-muted/20 transition-colors",
                    r.forbidden ? "opacity-60" : "",
                  )}
                >
                  <td className="py-1.5 px-3">
                    <input
                      type="checkbox"
                      checked={selectedRateKeys.has(rateKey(r, i))}
                      onChange={() => toggleOne(rateKey(r, i))}
                      data-testid={`checkbox-rate-${i}`}
                    />
                  </td>
                  <td className="py-1.5 px-3 font-mono text-[11px]">{r.rawPrefix || "—"}</td>
                  <td className="py-1.5 px-3">{r.destName}</td>
                  <td className="py-1.5 px-3 font-mono text-[11px] text-blue-400/80">{String(r.prefix ?? "—")}</td>
                  <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                    {r.price1 != null ? Number(r.price1).toFixed(5) : "—"}
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground whitespace-nowrap">
                    {r.activationDate ? (() => { const d = new Date(String(r.activationDate).replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T')); return isNaN(d.getTime()) ? String(r.activationDate).slice(0,10) : d.toLocaleDateString(); })() : "—"}
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground whitespace-nowrap">
                    {r.expirationDate ? (() => { const d = new Date(String(r.expirationDate).replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T')); return isNaN(d.getTime()) ? String(r.expirationDate).slice(0,10) : d.toLocaleDateString(); })() : "None"}
                  </td>
                  <td className="py-1.5 px-3">
                    {r.forbidden ? (
                      <span className="text-red-400 text-[10px]">Blocked</span>
                    ) : (
                      <span className="text-green-400 text-[10px]">Active</span>
                    )}
                  </td>
                </tr>
              ))}
              {rates.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-muted-foreground">
                    No rates found with prefix <span className="font-mono text-blue-400">"{trunkPrefix}*"</span> in Tariff #{iTariff}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border/30">
            {rates.length} rate{rates.length !== 1 ? "s" : ""} shown
            {trunkPrefix ? ` matching prefix "${trunkPrefix}*"` : ""} · Tariff #{iTariff}
          </div>
          </div>
        </div>
      )}
      {changeModalOpen && (
        <ChangeClientRateModal
          account={account}
          iTariff={iTariff ?? null}
          selectedRates={selectedRates}
          onClose={() => setChangeModalOpen(false)}
          onSuccess={() => {
            setChangeModalOpen(false);
            setSelectedRateKeys(new Set());
          }}
        />
      )}
    </div>
  );
}


// ── Change Client Rate Modal ────────────────────────────────────────────────────
function ChangeClientRateModal({
  account,
  iTariff,
  selectedRates,
  onClose,
  onSuccess,
}: {
  account: SippyAccount;
  iTariff: number | null;
  selectedRates: (RateEntry & { rawPrefix?: string; destName?: string })[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTill, setEffectiveTill] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<{ prefix: string; success: boolean; message: string; method?: string; detail?: string }[] | null>(null);

  // Proactive probe: check if the portal rates page is accessible before the user submits.
  // This catches the common case where the Sippy account lacks "Edit Tariff Rates" permission.
  const { data: probe } = useQuery<{ ok: boolean; ratesPageOk: boolean; error?: string }>({
    queryKey: ['/api/sippy/rates/portal-probe', iTariff],
    queryFn: () => fetch(`/api/sippy/rates/portal-probe?tariffId=${iTariff}`).then(r => r.json()),
    enabled: !!iTariff,
    staleTime: 2 * 60 * 1000,
    retry: false,
  });
  const permissionBlocked = probe && probe.ok === false && !probe.ratesPageOk;

  const handleSubmit = async () => {
    const rateNum = Number(rate);
    if (!rate || isNaN(rateNum)) {
      toast({ title: "Enter a valid rate", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setResults(null);
    try {
      // Always send the full Sippy prefix (r.prefix = e.g. "192"), NOT rawPrefix ("92").
      // rawPrefix strips the trunk prefix for display only — Sippy rate keys use the full prefix.
      const prefixes = selectedRates.map(r => String(r.prefix));
      const res = await apiRequest("POST", "/api/rate-manager/change-client-rates", {
        accountName: account.username,
        iTariff: iTariff ?? undefined,
        prefixes,
        rate: rateNum,
        effectiveFrom: effectiveFrom || undefined,
        effectiveTill: effectiveTill || undefined,
      });
      const data = await res.json();
      setResults(data.results ?? []);
      if (data.ok === prefixes.length) {
        toast({ title: `Updated ${data.ok} rate(s) successfully` });
        queryClient.invalidateQueries({ queryKey: [`/api/sippy/tariffs/${iTariff}/rates?limit=500`] });
        setTimeout(() => onSuccess(), 1200);
      } else {
        toast({ title: `${data.ok}/${prefixes.length} rate(s) updated`, description: "Some pushes failed — see details below.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Failed to change rates", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Change Client Rates — {account.username}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {permissionBlocked && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2.5 text-xs text-amber-300">
              <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-200">Rate push will fail — Sippy permission required</p>
                <p>The connected Sippy account (<strong>ssp-root</strong>) is a reseller and lacks the <strong>Edit Tariff Rates</strong> permission. To enable rate pushing, do one of:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-amber-300/80">
                  <li>In the Sippy Admin Panel, grant <strong>ssp-root</strong> the <em>Edit Tariff Rates</em> permission.</li>
                  <li>Go to <strong>Settings → Sippy → Rate Admin Credentials</strong> and enter a separate Sippy system admin account.</li>
                </ol>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Selected destinations ({selectedRates.length})</label>
            <div className="max-h-32 overflow-auto border border-border/50 rounded text-xs divide-y divide-border/30">
              {selectedRates.map((r, i) => (
                <div key={i} className="px-2 py-1 flex justify-between">
                  <span className="font-mono">{String(r.rawPrefix ?? r.prefix)}</span>
                  <span className="text-muted-foreground">{r.destName ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">New Rate (USD / min)</label>
            <input
              type="number"
              step="0.0001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="0.0100"
              className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm"
              data-testid="input-change-rate"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Active From</label>
              <input
                type="text"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                placeholder="YYYY-MM-DD HH:mm"
                className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Active Till</label>
              <input
                type="text"
                value={effectiveTill}
                onChange={(e) => setEffectiveTill(e.target.value)}
                placeholder="YYYY-MM-DD HH:mm"
                className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm font-mono"
              />
            </div>
          </div>
          {results && (
            <div className="border border-border/50 rounded text-xs divide-y divide-border/30 max-h-40 overflow-auto">
              {results.map((r, i) => (
                <div key={i} className="px-2 py-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono">{r.prefix}</span>
                    <span className="flex items-center gap-1">
                      {r.success ? <Check className="w-3 h-3 text-emerald-400" /> : <X className="w-3 h-3 text-red-400" />}
                      <span className={cn("text-[10px]", r.success ? "text-emerald-400" : "text-red-400")}>
                        {r.success ? (r.method ?? r.message) : (r.message ?? r.method ?? "push failed")}
                      </span>
                    </span>
                  </div>
                  {!r.success && r.method && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">via {r.method}{r.detail ? ` · ${r.detail}` : ""}</div>
                  )}
                  {!r.success && !r.method && r.detail && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">{r.detail}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted/30">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !rate}
            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded px-3 py-1.5 font-medium flex items-center gap-1.5"
            data-testid="btn-submit-change-rate"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rate Analysis Tab ──────────────────────────────────────────────────────────
function AnalysisTab({
  products,
  accounts,
  allDests,
  onProductChange,
}: {
  products: Product[];
  accounts: SippyAccount[];
  allDests: DestNode[];
  onProductChange?: (productId: string) => void;
}) {
  const [mode, setMode] = useState<"client" | "vendor">("client");
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedCarriers, setSelectedCarriers] = useState<string[]>([]);
  const [format, setFormat] = useState("Default");
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedOperators, setSelectedOperators] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedDetails, setSelectedDetails] = useState<string[]>([]);
  const [destInput, setDestInput] = useState("");
  const [groupBy, setGroupBy] = useState("Country");
  const [blockMode, setBlockMode] = useState("All");
  const [specialMode, setSpecialMode] = useState("All");
  const [period, setPeriod] = useState("Active");
  const [applied, setApplied] = useState(false);
  const [detailAccount, setDetailAccount] = useState<SippyAccount | null>(null);

  const product = products.find(p => String(p.id) === selectedProduct);
  const trunkPrefix = product?.trunkPrefix ?? "";

  // Destination hierarchy
  const countries = useMemo(() => allDests.filter(d => d.level === 1), [allDests]);
  const operators = useMemo(
    () => allDests.filter(d => d.level === 2 && selectedCountries.includes(String(d.parentId))),
    [allDests, selectedCountries],
  );
  const categories = useMemo(
    () => allDests.filter(d => d.level === 3 && selectedOperators.includes(String(d.parentId))),
    [allDests, selectedOperators],
  );
  const details = useMemo(
    () => allDests.filter(d => d.level === 4 && selectedCategories.includes(String(d.parentId))),
    [allDests, selectedCategories],
  );

  // Applied carriers
  const appliedCarriers = useMemo(
    () => accounts.filter(a => selectedCarriers.includes(String(a.iAccount))),
    [accounts, selectedCarriers],
  );

  const countryNames = useMemo(
    () => countries.filter(c => selectedCountries.includes(String(c.id))).map(c => c.name).join(", "),
    [countries, selectedCountries],
  );

  const handleApply = () => {
    setApplied(true);
    setDetailAccount(null);
  };
  const handleReset = () => {
    setSelectedProduct(""); setSelectedCarriers([]); setSelectedCountries([]);
    setSelectedOperators([]); setSelectedCategories([]); setSelectedDetails([]);
    setDestInput(""); setApplied(false); setDetailAccount(null);
    setFormat("Default"); setBlockMode("All"); setSpecialMode("All");
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-56 flex-shrink-0 border-r border-border/60 overflow-y-auto bg-muted/5 p-3 space-y-3">
        <div className="flex rounded overflow-hidden border border-border/60">
          {(["Client", "Vendor"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m.toLowerCase() as "client" | "vendor")}
              className={cn(
                "flex-1 py-1.5 text-xs font-semibold transition-colors",
                mode === m.toLowerCase()
                  ? "bg-green-600 text-white"
                  : "bg-background text-muted-foreground hover:bg-muted/40",
              )}
              data-testid={`mode-${m.toLowerCase()}`}
            >
              {m}
            </button>
          ))}
        </div>

        <SidebarSection title="Product">
          <select
            value={selectedProduct}
            onChange={e => {
              setSelectedProduct(e.target.value);
              setApplied(false);
              setDetailAccount(null);
              onProductChange?.(e.target.value);
            }}
            className="w-full text-xs border border-border/60 rounded px-2 py-1 bg-background text-foreground"
            data-testid="select-product"
          >
            <option value="">— Select product —</option>
            {products.map(p => (
              <option key={p.id} value={String(p.id)}>
                {p.name}{p.trunkPrefix ? ` [${p.trunkPrefix}]` : ""}
              </option>
            ))}
          </select>
          {product?.trunkPrefix && (
            <div className="text-[10px] text-muted-foreground px-1">
              Trunk prefix: <span className="font-mono text-blue-400">"{product.trunkPrefix}"</span>
              {" "}· e.g. <span className="font-mono text-muted-foreground">
                {product.trunkPrefix}92300 = PK Jazz
              </span>
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Carrier">
          <MultiSelect
            options={accounts.map(a => ({ value: String(a.iAccount), label: a.tariffName ? `${a.username} (${a.tariffName})` : a.username }))}
            value={selectedCarriers}
            onChange={setSelectedCarriers}
            placeholder="All carriers"
          />
        </SidebarSection>

        <SidebarSection title="Format">
          <ToggleButtons options={["Default", "Partial", "Full"]} value={format} onChange={setFormat} />
        </SidebarSection>

        <SidebarSection title="Destination Selection">
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground px-1">Country</div>
            <MultiSelect
              options={countries.map(d => ({ value: String(d.id), label: d.name }))}
              value={selectedCountries}
              onChange={v => { setSelectedCountries(v); setSelectedOperators([]); setSelectedCategories([]); setSelectedDetails([]); }}
            />
          </div>
          {selectedCountries.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground px-1">Operator Type</div>
              <MultiSelect
                options={operators.map(d => ({ value: String(d.id), label: d.name }))}
                value={selectedOperators}
                onChange={v => { setSelectedOperators(v); setSelectedCategories([]); setSelectedDetails([]); }}
              />
            </div>
          )}
          {selectedOperators.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground px-1">Category</div>
              <MultiSelect
                options={categories.map(d => ({ value: String(d.id), label: d.name }))}
                value={selectedCategories}
                onChange={v => { setSelectedCategories(v); setSelectedDetails([]); }}
              />
            </div>
          )}
          {selectedCategories.length > 0 && details.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground px-1">Detail</div>
              <MultiSelect
                options={details.map(d => ({ value: String(d.id), label: d.name }))}
                value={selectedDetails}
                onChange={setSelectedDetails}
              />
            </div>
          )}
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground px-1">Group By</div>
            <select
              value={groupBy}
              onChange={e => setGroupBy(e.target.value)}
              className="w-full text-xs border border-border/60 rounded px-2 py-1 bg-background"
            >
              {["Country", "Operator", "Category"].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground px-1">Destination</div>
            <input
              value={destInput}
              onChange={e => setDestInput(e.target.value)}
              placeholder="Filter by destination…"
              className="w-full text-xs border border-border/60 rounded px-2 py-1 bg-background placeholder:text-muted-foreground/50"
            />
          </div>
        </SidebarSection>

        <SidebarSection title="Block Destinations">
          <ToggleButtons options={["All", "Block", "Unblock"]} value={blockMode} onChange={setBlockMode} />
        </SidebarSection>

        <SidebarSection title="Special Destinations">
          <ToggleButtons options={["All", "Lock", "Unlock"]} value={specialMode} onChange={setSpecialMode} />
        </SidebarSection>

        <SidebarSection title="Rates Period">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="w-full text-xs border border-border/60 rounded px-2 py-1 bg-background"
          >
            {["Active", "Inactive", "Dormant", "All"].map(o => <option key={o}>{o}</option>)}
          </select>
        </SidebarSection>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleReset}
            className="flex-1 py-1.5 text-xs border border-border/60 rounded hover:bg-muted/40 text-muted-foreground"
            data-testid="btn-reset-analysis"
          >
            Reset
          </button>
          <button
            onClick={handleApply}
            disabled={!selectedProduct || selectedCarriers.length === 0}
            className="flex-1 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded font-semibold"
            data-testid="btn-apply-analysis"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {detailAccount ? (
          <RateDetailPanel
            account={detailAccount}
            trunkPrefix={trunkPrefix}
            allDests={allDests}
            selectedCountries={selectedCountries}
            selectedOperators={selectedOperators}
            selectedCategories={selectedCategories}
            selectedDetails={selectedDetails}
            onClose={() => setDetailAccount(null)}
          />
        ) : (
          <>
            {/* Summary table header */}
            {applied && appliedCarriers.length > 0 && (
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/10 flex-shrink-0">
                <div className="text-xs text-muted-foreground">
                  {appliedCarriers.length} carrier{appliedCarriers.length !== 1 ? "s" : ""}
                  {countryNames ? ` · ${countryNames}` : ""}
                  {product ? ` · ${product.name}` : ""}
                </div>
                <span className="text-[10px] text-muted-foreground italic">Click "View Details" on a carrier to change rates</span>
              </div>
            )}

            <div className="flex-1 overflow-auto">
              {!applied ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3 p-8">
                  <BarChart2 className="w-10 h-10 opacity-20" />
                  <div>
                    <p className="text-sm font-medium">No analysis applied</p>
                    <p className="text-xs mt-1 max-w-xs">
                      Select a product and at least one carrier in the left panel, then click Apply.
                    </p>
                  </div>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-muted/30 backdrop-blur z-10">
                    <tr>
                      {["Carrier Name", "Country", "Total Dest.", "Block Dest.", "Total Codes", "Actions"].map(h => (
                        <th key={h} className="text-left py-2 px-4 font-medium text-muted-foreground border-b border-border whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {appliedCarriers.map(acct => (
                      <tr
                        key={acct.iAccount}
                        className="border-b border-border/30 hover:bg-muted/20 transition-colors"
                        data-testid={`carrier-row-${acct.iAccount}`}
                      >
                        <td className="py-2.5 px-4 font-medium">{acct.username}</td>
                        <td className="py-2.5 px-4 text-muted-foreground">
                          {countryNames || "All countries"}
                        </td>
                        <td className="py-2.5 px-4 text-muted-foreground">—</td>
                        <td className="py-2.5 px-4 text-muted-foreground">—</td>
                        <td className="py-2.5 px-4 text-muted-foreground">—</td>
                        <td className="py-2.5 px-4">
                          <button
                            onClick={() => setDetailAccount(acct)}
                            className="flex items-center gap-1 text-primary hover:underline text-xs"
                            data-testid={`btn-view-details-${acct.iAccount}`}
                          >
                            <Eye className="w-3 h-3" /> View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Send Rate Tab ──────────────────────────────────────────────────────────────
type QueuedDest = {
  qid: string;
  destLabel: string;
  dialPrefix: string;  // normalized (no leading +)
  fullPrefix: string;  // trunkPrefix + dialPrefix
  rate: string;
};

function SendRateTab({
  products,
  accounts,
  allDests,
  onProductChange,
}: {
  products: Product[];
  accounts: SippyAccount[];
  allDests: DestNode[];
  onProductChange?: (productId: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [status, setStatus] = useState("Active");
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [format, setFormat] = useState("Default");
  const [rateType, setRateType] = useState("Current");

  // Destination picker state
  const [notifCountry, setNotifCountry] = useState<string>("");
  const [notifOperator, setNotifOperator] = useState<string>("");
  const [notifCategory, setNotifCategory] = useState<string>("");
  const [notifDetail, setNotifDetail] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [effectiveDate, setEffectiveDate] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  // Multi-destination queue
  const [destQueue, setDestQueue] = useState<QueuedDest[]>([]);
  const [pushResults, setPushResults] = useState<{ accountName: string; prefix: string; rate: number; success: boolean; message: string }[] | null>(null);
  const [pushing, setPushing] = useState(false);

  const product = products.find(p => String(p.id) === selectedProduct);
  const trunkPrefix = product?.trunkPrefix ?? "";
  const stripPlus = (s: string) => s.replace(/^\+/, '');

  const countries = useMemo(() => allDests.filter(d => d.level === 1), [allDests]);
  const operators = useMemo(
    () => notifCountry ? allDests.filter(d => d.level === 2 && String(d.parentId) === notifCountry) : [],
    [allDests, notifCountry],
  );
  const categories = useMemo(
    () => notifOperator ? allDests.filter(d => d.level === 3 && String(d.parentId) === notifOperator) : [],
    [allDests, notifOperator],
  );
  const details = useMemo(
    () => notifCategory ? allDests.filter(d => d.level === 4 && String(d.parentId) === notifCategory) : [],
    [allDests, notifCategory],
  );

  // Resolve the most specific dialPrefix — normalize "+" away
  const resolvedDialPrefix = useMemo(() => {
    const detailNode = allDests.find(d => String(d.id) === notifDetail);
    if (detailNode?.dialPrefix) return stripPlus(detailNode.dialPrefix);
    const catNode = allDests.find(d => String(d.id) === notifCategory);
    if (catNode?.dialPrefix) return stripPlus(catNode.dialPrefix);
    const opNode = allDests.find(d => String(d.id) === notifOperator);
    if (opNode?.dialPrefix) return stripPlus(opNode.dialPrefix);
    const cNode = allDests.find(d => String(d.id) === notifCountry);
    if (cNode?.dialPrefix) return stripPlus(cNode.dialPrefix);
    return "";
  }, [allDests, notifCountry, notifOperator, notifCategory, notifDetail]);

  const previewFullPrefix = trunkPrefix + resolvedDialPrefix;

  const selectedClientAccounts = useMemo(
    () => accounts.filter(a => selectedClients.includes(String(a.iAccount))),
    [accounts, selectedClients],
  );

  const canAddToQueue = !!(resolvedDialPrefix && price && parseFloat(price) > 0);
  const canSubmit = !!(selectedProduct && selectedClients.length > 0 && destQueue.length > 0 && !pushing);

  const handleAddToQueue = () => {
    if (!canAddToQueue) return;
    const computedFull = trunkPrefix + resolvedDialPrefix;
    if (destQueue.some(q => q.fullPrefix === computedFull)) {
      toast({ title: "Duplicate prefix", description: `${computedFull} is already in the queue`, variant: "destructive" });
      return;
    }
    const countryName  = allDests.find(d => String(d.id) === notifCountry)?.name  ?? "";
    const operatorName = allDests.find(d => String(d.id) === notifOperator)?.name ?? "";
    const categoryName = allDests.find(d => String(d.id) === notifCategory)?.name ?? "";
    const detailName   = allDests.find(d => String(d.id) === notifDetail)?.name   ?? "";
    const destLabel = [countryName, operatorName, categoryName, detailName].filter(Boolean).join(" \u203a ");
    setDestQueue(prev => [...prev, {
      qid: `${Date.now()}-${Math.random()}`,
      destLabel,
      dialPrefix: resolvedDialPrefix,
      fullPrefix: computedFull,
      rate: price,
    }]);
    setNotifCountry(""); setNotifOperator(""); setNotifCategory(""); setNotifDetail(""); setPrice("");
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPushing(true);
    setPushResults(null);
    try {
      const body = {
        accountNames: selectedClientAccounts.map(a => a.username),
        trunkPrefix,
        destinations: destQueue.map(q => ({ dialPrefix: q.dialPrefix, rate: parseFloat(q.rate) })),
        effectiveFrom: effectiveDate || undefined,
        format: format.toLowerCase(),
        productName: product?.name,
        rateType: rateType.toLowerCase(),
      };
      const res = await apiRequest("POST", "/api/rate-manager/push-batch", body);
      const data = await res.json();
      setPushResults(data.results ?? []);
      qc.invalidateQueries({ queryKey: ["/api/rate-manager/jobs"] });
      toast({
        title: `Rate Push — ${data.ok}/${data.total} succeeded`,
        description: `${destQueue.length} destination${destQueue.length > 1 ? "s" : ""} × ${selectedClients.length} client${selectedClients.length > 1 ? "s" : ""}`,
        variant: data.ok === data.total ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({ title: "Push failed", description: e.message, variant: "destructive" });
    } finally {
      setPushing(false);
    }
  };

  const handleReset = () => {
    setSelectedProduct(""); setSelectedClients([]); setFormat("Default"); setRateType("Current");
    setNotifCountry(""); setNotifOperator(""); setNotifCategory(""); setNotifDetail("");
    setPrice(""); setDestQueue([]); setPushResults(null);
    onProductChange?.("");
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-56 flex-shrink-0 border-r border-border/60 overflow-y-auto bg-muted/5 p-3 space-y-3">
        <SidebarSection title="Send Rate">
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground px-1">Status</div>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-full text-xs border border-border/60 rounded px-2 py-1 bg-background"
            >
              {["Active", "Inactive", "Dormant"].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        </SidebarSection>

        <SidebarSection title="Product">
          <select
            value={selectedProduct}
            onChange={e => {
              setSelectedProduct(e.target.value);
              setSelectedClients([]);
              onProductChange?.(e.target.value);
            }}
            className="w-full text-xs border border-border/60 rounded px-2 py-1 bg-background"
            data-testid="send-select-product"
          >
            <option value="">— Select product —</option>
            {products.map(p => (
              <option key={p.id} value={String(p.id)}>
                {p.name}{p.trunkPrefix ? ` [${p.trunkPrefix}]` : ""}
              </option>
            ))}
          </select>
        </SidebarSection>

        <SidebarSection title="Clients">
          <MultiSelect
            options={accounts.map(a => ({ value: String(a.iAccount), label: a.tariffName ? `${a.username} (${a.tariffName})` : a.username }))}
            value={selectedClients}
            onChange={setSelectedClients}
            placeholder="Select clients"
          />
        </SidebarSection>

        <SidebarSection title="Format">
          <ToggleButtons options={["Default", "Changes", "Full"]} value={format} onChange={setFormat} />
        </SidebarSection>

        <SidebarSection title="Rate Type">
          <ToggleButtons options={["Current", "Re-Rate"]} value={rateType} onChange={setRateType} />
        </SidebarSection>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleReset}
            className="flex-1 py-1.5 text-xs border border-border/60 rounded hover:bg-muted/40 text-muted-foreground"
            data-testid="btn-reset-send"
          >
            Reset
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded font-semibold flex items-center justify-center gap-1"
            data-testid="btn-submit-send"
          >
            {pushing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            {pushing ? "Pushing…" : "Submit"}
          </button>
        </div>

        {/* Readiness checklist */}
        <div className="text-[10px] space-y-0.5 px-1 pt-0.5">
          <div className={selectedProduct ? "text-green-400/70" : "text-amber-400/80"}>
            {selectedProduct ? "✓ Product selected" : "· Select a product"}
          </div>
          <div className={selectedClients.length > 0 ? "text-green-400/70" : "text-amber-400/80"}>
            {selectedClients.length > 0 ? `✓ ${selectedClients.length} client${selectedClients.length > 1 ? "s" : ""}` : "· Select clients"}
          </div>
          <div className={destQueue.length > 0 ? "text-green-400/70" : "text-amber-400/80"}>
            {destQueue.length > 0 ? `✓ ${destQueue.length} destination${destQueue.length > 1 ? "s" : ""} queued` : "· Add destinations →"}
          </div>
        </div>

        {/* Selected Clients List */}
        {selectedClientAccounts.length > 0 && (
          <SidebarSection title="Selected Clients">
            <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
              {selectedClientAccounts.map((a, i) => (
                <div key={a.iAccount} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="text-primary/60 w-4 shrink-0">{i + 1}.</span>
                  <span className="truncate">{a.username}</span>
                </div>
              ))}
            </div>
          </SidebarSection>
        )}
      </div>

      {/* Right Panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-auto p-5 gap-4">

        {/* ── Destination Queue ── */}
        <div>
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Send className="w-4 h-4 text-green-400" />
            Destination Queue
            {destQueue.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] font-medium border border-green-500/20">
                {destQueue.length} destination{destQueue.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {destQueue.length > 0 ? (
            <div className="border border-border/50 rounded-lg overflow-hidden mb-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 bg-muted/10">
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Destination</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium w-28">Sippy Prefix</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium w-28">Rate ($/min)</th>
                    <th className="py-2 px-3 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {destQueue.map(q => (
                    <tr key={q.qid} className="border-b border-border/20 hover:bg-muted/5">
                      <td className="py-2 px-3 text-foreground/80">{q.destLabel}</td>
                      <td className="py-2 px-3 font-mono text-blue-400">{q.fullPrefix}</td>
                      <td className="py-2 px-3 font-mono text-green-400">{parseFloat(q.rate).toFixed(5)}</td>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => setDestQueue(prev => prev.filter(x => x.qid !== q.qid))}
                          className="text-muted-foreground hover:text-red-400 transition-colors"
                          title="Remove"
                          data-testid={`btn-remove-dest-${q.qid}`}
                        >
                          <CircleX className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border border-dashed border-border/40 rounded-lg p-4 mb-3 text-xs text-muted-foreground text-center">
              No destinations queued — use the picker below to add destinations
            </div>
          )}

          {/* Push All button row */}
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-muted-foreground">
              {canSubmit
                ? `Will push ${destQueue.length} destination${destQueue.length > 1 ? "s" : ""} to ${selectedClients.length} client${selectedClients.length > 1 ? "s" : ""} (${destQueue.length * selectedClients.length} total ops)`
                : "Complete the checklist on the left, then add at least one destination"}
            </div>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="shrink-0 px-5 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded font-semibold flex items-center gap-1.5"
              data-testid="btn-submit-notification"
            >
              {pushing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {pushing ? "Pushing…" : "Push All"}
            </button>
          </div>
        </div>

        {/* ── Add Destination Picker ── */}
        <div className="bg-muted/10 border border-border/50 rounded-lg p-4 space-y-3">
          <div className="text-xs font-semibold text-foreground/70 mb-1 flex items-center gap-2">
            Add Destination
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Country</label>
              <select
                value={notifCountry}
                onChange={e => { setNotifCountry(e.target.value); setNotifOperator(""); setNotifCategory(""); setNotifDetail(""); }}
                className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background"
                data-testid="notif-country"
              >
                <option value="">Choose a country</option>
                {countries.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Network / Type</label>
              <select
                value={notifOperator}
                onChange={e => { setNotifOperator(e.target.value); setNotifCategory(""); setNotifDetail(""); }}
                disabled={!notifCountry || operators.length === 0}
                className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background disabled:opacity-50"
                data-testid="notif-operator"
              >
                <option value="">Select network</option>
                {operators.map(d => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}{d.dialPrefix ? ` (${stripPlus(d.dialPrefix)})` : ""}
                  </option>
                ))}
              </select>
            </div>
            {categories.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">Operator</label>
                <select
                  value={notifCategory}
                  onChange={e => { setNotifCategory(e.target.value); setNotifDetail(""); }}
                  className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background"
                  data-testid="notif-category"
                >
                  <option value="">Select operator</option>
                  {categories.map(d => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name}{d.dialPrefix ? ` (${stripPlus(d.dialPrefix)})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {details.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">Detail</label>
                <select
                  value={notifDetail}
                  onChange={e => setNotifDetail(e.target.value)}
                  className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background"
                  data-testid="notif-detail"
                >
                  <option value="">Select detail</option>
                  {details.map(d => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name}{d.dialPrefix ? ` (${stripPlus(d.dialPrefix)})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Price (USD/min)</label>
              <input
                type="number"
                step="0.00001"
                min="0"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="e.g. 0.02700"
                className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background font-mono"
                data-testid="notif-price"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Effective Date / Time</label>
              <input
                type="text"
                value={effectiveDate}
                onChange={e => setEffectiveDate(e.target.value)}
                placeholder="YYYY-MM-DD HH:mm"
                className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background font-mono"
                data-testid="notif-date"
              />
            </div>
          </div>

          {/* Prefix preview + Add button */}
          <div className="flex items-center justify-between gap-3 pt-1">
            {resolvedDialPrefix ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>Sippy prefix:</span>
                <span className="font-mono text-blue-400 font-semibold">{previewFullPrefix}</span>
                <span className="text-foreground/40 text-[10px]">
                  (trunk <span className="font-mono text-amber-400">{trunkPrefix || "?"}</span>
                  {" + "}<span className="font-mono text-green-400">{resolvedDialPrefix}</span>)
                </span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground/50 italic">
                Select country → network to resolve Sippy prefix
              </div>
            )}
            <button
              onClick={handleAddToQueue}
              disabled={!canAddToQueue}
              className="shrink-0 px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded font-semibold flex items-center gap-1.5"
              data-testid="btn-add-to-queue"
            >
              <CircleCheck className="w-3 h-3" />
              Add to Queue
            </button>
          </div>
        </div>

        {/* Push Results */}
        {pushResults && (
          <div className="border border-border/50 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-muted/20 border-b border-border/50 text-xs font-medium flex items-center gap-2">
              <CircleCheck className="w-3.5 h-3.5 text-green-400" />
              Push Results
              <span className="ml-auto text-muted-foreground">
                {pushResults.filter(r => r.success).length}/{pushResults.length} succeeded
              </span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 bg-muted/10">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Client</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Prefix</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Rate</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Status</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {pushResults.map((r, i) => (
                  <tr key={i} className="border-b border-border/20 hover:bg-muted/10">
                    <td className="py-2 px-3 font-medium">{r.accountName}</td>
                    <td className="py-2 px-3 font-mono text-blue-400">{r.prefix}</td>
                    <td className="py-2 px-3 font-mono">{Number(r.rate).toFixed(5)}</td>
                    <td className="py-2 px-3">
                      {r.success
                        ? <span className="flex items-center gap-1 text-green-400"><CircleCheck className="w-3 h-3" /> OK</span>
                        : <span className="flex items-center gap-1 text-red-400"><CircleX className="w-3 h-3" /> Fail</span>}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-xs">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
// ── Jobs Tab ───────────────────────────────────────────────────────────────────
function JobsTab() {
  const { data: jobs = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/rate-manager/jobs"] });

  const STATUS_COLOR: Record<string, string> = {
    completed: "text-green-400",
    partial:   "text-amber-400",
    failed:    "text-red-400",
    pending:   "text-muted-foreground",
    processing:"text-blue-400",
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        Rate Push History
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : !jobs?.length ? (
        <div className="text-center text-xs text-muted-foreground py-12">No rate push jobs yet</div>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border/50 bg-muted/20">
              {["Job ID", "Product", "Full Prefix", "New Rate", "Method", "Verified", "Clients", "Status", "Completed"].map(h => (
                <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j: any) => {
              const verColor = j.verificationResult === 'confirmed' ? 'text-green-400'
                : j.verificationResult === 'mismatch' ? 'text-red-400'
                : 'text-muted-foreground';
              const methodColor = j.pushMethod === 'upload_token' ? 'text-blue-400'
                : j.pushMethod === 'portal_csv' ? 'text-amber-400'
                : j.pushMethod ? 'text-muted-foreground' : 'text-muted-foreground/50';
              return (
                <tr key={j.id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="py-2 px-3 font-mono text-[10px] text-muted-foreground">{j.jobId}</td>
                  <td className="py-2 px-3">{j.productName ?? "—"}</td>
                  <td className="py-2 px-3 font-mono text-amber-400">{j.fullPrefix || j.trunkPrefix || "—"}</td>
                  <td className="py-2 px-3 font-mono tabular-nums">
                    {j.newRate != null ? `$${Number(j.newRate).toFixed(5)}` : "—"}
                  </td>
                  <td className={cn("py-2 px-3 font-mono text-[10px]", methodColor)}>
                    {j.pushMethod ?? "—"}
                  </td>
                  <td className={cn("py-2 px-3 font-medium capitalize text-[11px]", verColor)}>
                    {j.verificationResult ?? "—"}
                  </td>
                  <td className="py-2 px-3 tabular-nums">
                    {j.pushedClients ?? 0}/{j.totalClients ?? 0}
                    {(j.failedClients ?? 0) > 0 && (
                      <span className="text-red-400 ml-1">({j.failedClients} failed)</span>
                    )}
                  </td>
                  <td className={cn("py-2 px-3 font-medium capitalize", STATUS_COLOR[j.status] ?? "text-muted-foreground")}>
                    {j.status}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                    {j.completedAt ? new Date(j.completedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Product Rates Tab ─────────────────────────────────────────────────────────
function ProductRatesTab({ products }: { products: Product[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ prefix: "", rate: "", currency: "USD", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", notes: "" });

  const { data: rates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/product-rates", selectedProductId],
    queryFn: () => fetch(`/api/product-rates${selectedProductId ? `?productId=${selectedProductId}` : ""}`).then(r => r.json()),
    enabled: true,
  });

  const createMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/product-rates", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-rates"] });
      setShowForm(false);
      setForm({ prefix: "", rate: "", currency: "USD", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", notes: "" });
      toast({ title: "Rate created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/product-rates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-rates"] }); toast({ title: "Rate deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleCreate = () => {
    if (!selectedProductId || !form.rate || !form.effectiveFrom) {
      toast({ title: "Select a product and fill rate + effective date", variant: "destructive" }); return;
    }
    createMut.mutate({ productId: Number(selectedProductId), ...form });
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-48 shrink-0 border-r border-border/50 flex flex-col gap-0 overflow-y-auto py-2">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Product</div>
        {products.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedProductId(String(p.id))}
            data-testid={`product-rate-select-${p.id}`}
            className={cn(
              "text-left px-3 py-2 text-xs flex items-center gap-2 border-l-2 transition-colors",
              selectedProductId === String(p.id) ? "border-primary bg-muted/30 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10",
            )}
          >
            <Tag className="w-3 h-3 shrink-0" />
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-muted/10">
          <div className="text-xs font-medium flex items-center gap-2">
            <PackageCheck className="w-3.5 h-3.5 text-blue-400" />
            Product Rate Repository
            {selectedProductId && <span className="text-muted-foreground">— {products.find(p => String(p.id) === selectedProductId)?.name}</span>}
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            data-testid="btn-add-rate"
            className="flex items-center gap-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary px-2.5 py-1 rounded transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Rate
          </button>
        </div>

        {showForm && (
          <div className="border-b border-border/30 bg-muted/5 px-4 py-3 flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Prefix</label>
              <input data-testid="input-rate-prefix" className="bg-muted border border-border rounded px-2 py-1 text-xs w-32 font-mono" placeholder="e.g. 9230" value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Rate (USD/min)</label>
              <input data-testid="input-rate-value" type="number" step="0.000001" className="bg-muted border border-border rounded px-2 py-1 text-xs w-28 font-mono" placeholder="0.000000" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Effective From</label>
              <input data-testid="input-rate-from" type="date" className="bg-muted border border-border rounded px-2 py-1 text-xs w-36" value={form.effectiveFrom} onChange={e => setForm(f => ({ ...f, effectiveFrom: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Effective To (optional)</label>
              <input data-testid="input-rate-to" type="date" className="bg-muted border border-border rounded px-2 py-1 text-xs w-36" value={form.effectiveTo} onChange={e => setForm(f => ({ ...f, effectiveTo: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Notes</label>
              <input data-testid="input-rate-notes" className="bg-muted border border-border rounded px-2 py-1 text-xs w-48" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <button onClick={handleCreate} disabled={createMut.isPending} data-testid="btn-save-rate"
              className="flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded transition-colors disabled:opacity-50">
              {createMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">Cancel</button>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 justify-center py-12 text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : rates.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-12">
              {selectedProductId ? "No rates configured for this product yet" : "Select a product to view its rates"}
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20 sticky top-0">
                  {["Prefix", "Rate (USD/min)", "Currency", "Effective From", "Effective To", "Notes", "Created By", ""].map(h => (
                    <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rates.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/20 hover:bg-muted/10" data-testid={`row-rate-${r.id}`}>
                    <td className="py-2 px-3 font-mono text-amber-400">{r.prefix || "—"}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{Number(r.rate).toFixed(6)}</td>
                    <td className="py-2 px-3">{r.currency}</td>
                    <td className="py-2 px-3 tabular-nums">{r.effectiveFrom}</td>
                    <td className="py-2 px-3 tabular-nums text-muted-foreground">{r.effectiveTo || "—"}</td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-xs">{r.notes || "—"}</td>
                    <td className="py-2 px-3 text-muted-foreground">{r.createdBy || "—"}</td>
                    <td className="py-2 px-3">
                      <button onClick={() => deleteMut.mutate(r.id)} data-testid={`btn-delete-rate-${r.id}`}
                        className="text-red-400 hover:text-red-300 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Notifications Tab ─────────────────────────────────────────────────────────
function NotificationsTab({ products }: { products: Product[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    tariffId: "", productId: "", notificationType: "rate_change",
    subject: "", message: "", scheduledFor: "",
  });

  const { data: notifications = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/rate-notifications"] });

  const createMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/rate-notifications", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/rate-notifications"] });
      setShowForm(false);
      setForm({ tariffId: "", productId: "", notificationType: "rate_change", subject: "", message: "", scheduledFor: "" });
      toast({ title: "Notification queued" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/rate-notifications/${id}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/rate-notifications"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const NOTIF_LABELS: Record<string, { label: string; color: string }> = {
    rate_change:     { label: "Rate Change",      color: "text-blue-400"   },
    price_increase:  { label: "Price Increase",   color: "text-red-400"    },
    price_decrease:  { label: "Price Decrease",   color: "text-green-400"  },
    "7_day_notice":  { label: "7-Day Notice",     color: "text-amber-400"  },
  };

  const STATUS_COLOR: Record<string, string> = {
    pending:   "text-amber-400",
    sent:      "text-green-400",
    cancelled: "text-muted-foreground",
    failed:    "text-red-400",
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold flex items-center gap-2">
          <BellRing className="w-4 h-4 text-amber-400" />
          Rate Notifications &amp; 7-Day Queue
        </div>
        <button onClick={() => setShowForm(v => !v)} data-testid="btn-new-notification"
          className="flex items-center gap-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary px-2.5 py-1 rounded transition-colors">
          <Plus className="w-3 h-3" /> New Notification
        </button>
      </div>

      {showForm && (
        <div className="border border-border/40 rounded-md bg-muted/10 p-4 mb-4 flex flex-col gap-3">
          <div className="text-xs font-medium text-muted-foreground mb-1">Create Rate Notification</div>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Type</label>
              <select data-testid="select-notif-type" className="bg-muted border border-border rounded px-2 py-1 text-xs w-36"
                value={form.notificationType} onChange={e => setForm(f => ({ ...f, notificationType: e.target.value }))}>
                <option value="rate_change">Rate Change</option>
                <option value="price_increase">Price Increase</option>
                <option value="price_decrease">Price Decrease</option>
                <option value="7_day_notice">7-Day Notice</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Tariff ID</label>
              <input data-testid="input-notif-tariff" className="bg-muted border border-border rounded px-2 py-1 text-xs w-28 font-mono"
                placeholder="e.g. 8" value={form.tariffId} onChange={e => setForm(f => ({ ...f, tariffId: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Product</label>
              <select data-testid="select-notif-product" className="bg-muted border border-border rounded px-2 py-1 text-xs w-40"
                value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))}>
                <option value="">— None —</option>
                {products.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Schedule For (optional)</label>
              <input data-testid="input-notif-schedule" type="text" placeholder="YYYY-MM-DD HH:mm" className="bg-muted border border-border rounded px-2 py-1 text-xs w-44 font-mono"
                value={form.scheduledFor} onChange={e => setForm(f => ({ ...f, scheduledFor: e.target.value }))} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">Subject</label>
            <input data-testid="input-notif-subject" className="bg-muted border border-border rounded px-2 py-1 text-xs w-full max-w-md"
              placeholder="Rate change notification for Pakistan" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">Message</label>
            <textarea data-testid="input-notif-message" rows={3} className="bg-muted border border-border rounded px-2 py-1 text-xs w-full max-w-md resize-none"
              placeholder="Effective 7 days from today, the following rates will change…" value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => createMut.mutate({ ...form, productId: form.productId || undefined })} disabled={createMut.isPending}
              data-testid="btn-save-notification"
              className="flex items-center gap-1 text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded transition-colors disabled:opacity-50">
              {createMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />} Queue Notification
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 justify-center py-12 text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="text-center text-xs text-muted-foreground py-12">No notifications queued yet</div>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border/50 bg-muted/20">
              {["Type", "Subject", "Tariff", "Affected", "Scheduled", "Status", "Created", "Actions"].map(h => (
                <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {notifications.map((n: any) => {
              const typeInfo = NOTIF_LABELS[n.notificationType] ?? { label: n.notificationType, color: "text-foreground" };
              return (
                <tr key={n.id} className="border-b border-border/20 hover:bg-muted/10" data-testid={`row-notif-${n.id}`}>
                  <td className={cn("py-2 px-3 font-medium", typeInfo.color)}>{typeInfo.label}</td>
                  <td className="py-2 px-3 truncate max-w-xs">{n.subject}</td>
                  <td className="py-2 px-3 font-mono text-muted-foreground">{n.tariffId || "—"}</td>
                  <td className="py-2 px-3 tabular-nums">{n.affectedCount ?? 0} accounts</td>
                  <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                    {n.scheduledFor ? new Date(n.scheduledFor).toLocaleDateString() : "Immediate"}
                  </td>
                  <td className={cn("py-2 px-3 font-medium capitalize", STATUS_COLOR[n.status] ?? "text-muted-foreground")}>{n.status}</td>
                  <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{new Date(n.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 px-3 flex gap-1">
                    {n.status === 'pending' && (
                      <>
                        <button onClick={() => statusMut.mutate({ id: n.id, status: 'sent' })}
                          data-testid={`btn-send-notif-${n.id}`}
                          className="text-green-400 hover:text-green-300 text-[10px] px-1.5 py-0.5 border border-green-400/30 rounded">
                          Mark Sent
                        </button>
                        <button onClick={() => statusMut.mutate({ id: n.id, status: 'cancelled' })}
                          data-testid={`btn-cancel-notif-${n.id}`}
                          className="text-muted-foreground hover:text-foreground text-[10px] px-1.5 py-0.5 border border-border/40 rounded">
                          Cancel
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Pricing Intelligence Tab ──────────────────────────────────────────────────
function PricingIntelligenceTab({ products }: { products: Product[] }) {
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  const { data, isLoading, refetch } = useQuery<{ recommendations: any[]; generatedAt: string }>({
    queryKey: ["/api/pricing-intelligence", selectedProductId],
    queryFn: () => fetch(`/api/pricing-intelligence${selectedProductId ? `?productId=${selectedProductId}` : ""}`).then(r => r.json()),
  });

  const PRIORITY_CONFIG = {
    high:   { color: "text-red-400",    bg: "bg-red-400/10",   icon: TrendingUp,   label: "High Priority"   },
    medium: { color: "text-amber-400",  bg: "bg-amber-400/10", icon: TrendingDown, label: "Medium Priority" },
    low:    { color: "text-green-400",  bg: "bg-green-400/10", icon: Lightbulb,    label: "Low Priority"    },
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-48 shrink-0 border-r border-border/50 flex flex-col gap-0 overflow-y-auto py-2">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Filter Product</div>
        <button
          onClick={() => setSelectedProductId("")}
          className={cn(
            "text-left px-3 py-2 text-xs border-l-2 transition-colors",
            !selectedProductId ? "border-primary bg-muted/30 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10",
          )}
          data-testid="product-intel-all"
        >
          All Products
        </button>
        {products.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedProductId(String(p.id))}
            data-testid={`product-intel-${p.id}`}
            className={cn(
              "text-left px-3 py-2 text-xs flex items-center gap-2 border-l-2 transition-colors",
              selectedProductId === String(p.id) ? "border-primary bg-muted/30 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10",
            )}
          >
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>

      {/* Main */}
      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-yellow-400" />
            Pricing Intelligence
          </div>
          <button onClick={() => refetch()} data-testid="btn-refresh-intel"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 justify-center py-12 text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Analysing…</div>
        ) : !data?.recommendations?.length ? (
          <div className="text-center text-xs text-muted-foreground py-12">No commercial products found — activate products in the Product Registry first</div>
        ) : (
          <div className="flex flex-col gap-3">
            {data.generatedAt && (
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Generated {new Date(data.generatedAt).toLocaleString()}
              </div>
            )}
            {data.recommendations.map((rec: any) => {
              const cfg = PRIORITY_CONFIG[rec.priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.low;
              const Icon = cfg.icon;
              return (
                <div key={rec.productId} data-testid={`intel-card-${rec.productId}`}
                  className={cn("border border-border/40 rounded-md p-3 flex flex-col gap-2", cfg.bg)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className={cn("w-3.5 h-3.5 shrink-0", cfg.color)} />
                      <span className="text-xs font-medium">{rec.productName}</span>
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", cfg.color, cfg.bg)}>{cfg.label}</span>
                    </div>
                    <div className="flex gap-4 text-[10px] text-muted-foreground shrink-0">
                      <span>{rec.rateCount} rate{rec.rateCount !== 1 ? 's' : ''}</span>
                      <span>{rec.customerCount} customer{rec.customerCount !== 1 ? 's' : ''}</span>
                      {rec.avgRate !== null && (
                        <span className="font-mono">${Number(rec.avgRate).toFixed(6)}/min avg</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{rec.recommendation}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Main Page ──────────────────────────────────────────────────────────────────
export default function RateManagerPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"analysis" | "send" | "jobs" | "product-rates" | "notifications" | "intelligence">("analysis");

  const { data: products = [], isLoading: prodLoading } = useQuery<Product[]>({
    queryKey: ["/api/rate-manager/products"],
  });

  // Use selected product from products list to filter clients
  const [activeProductId, setActiveProductId] = useState<string>("");
  const { data: accountsData, isLoading: acctLoading } = useQuery<{
    accounts: SippyAccount[]; error?: string; productName?: string;
  }>({
    queryKey: ["/api/sippy/accounts-by-product", activeProductId],
    enabled: !!activeProductId,
  });
  const accounts = accountsData?.accounts ?? [];

  const { data: destsData } = useQuery<{ destinations?: DestNode[]; items?: DestNode[] } | DestNode[]>({
    queryKey: ["/api/product-registry/destinations"],
  });
  const allDests: DestNode[] = useMemo(() => {
    if (!destsData) return [];
    if (Array.isArray(destsData)) return destsData;
    return (destsData as any).destinations ?? (destsData as any).items ?? [];
  }, [destsData]);

  const isLoading = prodLoading || acctLoading;

  const TABS = [
    { key: "analysis"      as const, label: "Rate Analysis"   },
    { key: "send"          as const, label: "Send Rate"        },
    { key: "jobs"          as const, label: "Push History"     },
    { key: "product-rates" as const, label: "Product Rates"   },
    { key: "notifications" as const, label: "Notifications"   },
    { key: "intelligence"  as const, label: "Intelligence"    },
  ];

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Top bar */}
      <div className="flex-shrink-0 border-b border-border bg-background/95 flex items-center gap-0 px-4 h-10">
        <div className="flex items-center gap-2 text-xs font-semibold mr-4 pr-4 border-r border-border/40">
          <BarChart2 className="w-3.5 h-3.5 text-blue-400" />
          Rate Manager
        </div>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "px-4 h-full text-xs font-medium border-b-2 transition-colors",
              activeTab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            data-testid={`tab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {accountsData?.productName && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
              <PackageCheck className="w-3 h-3" />
              {accountsData.productName}
              {accountsData.accounts.length > 0 && (
                <span className="ml-1 text-blue-300/70">{accountsData.accounts.length} clients</span>
              )}
            </span>
          )}
          {activeProductId && accountsData && accountsData.accounts.length === 0 && !acctLoading && (
            <span className={`text-[10px] flex items-center gap-1 ${(accountsData as any).syncing ? 'text-blue-400' : 'text-amber-400'}`}>
              {(accountsData as any).syncing
                ? <><Loader2 className="w-3 h-3 animate-spin" />Syncing tariff data from Sippy…</>
                : <><AlertTriangle className="w-3 h-3" />No clients assigned to this product</>
              }
            </span>
          )}
          {(accountsData?.error) && (
            <span className="text-[10px] text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {accountsData.error.length > 60 ? accountsData.error.slice(0, 60) + "…" : accountsData.error}
            </span>
          )}
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "analysis"      && <AnalysisTab products={products} accounts={accounts} allDests={allDests} onProductChange={setActiveProductId} />}
      {activeTab === "send"          && <SendRateTab products={products} accounts={accounts} allDests={allDests} onProductChange={setActiveProductId} />}
      {activeTab === "jobs"          && <JobsTab />}
      {activeTab === "product-rates" && <ProductRatesTab products={products} />}
      {activeTab === "notifications" && <NotificationsTab products={products} />}
      {activeTab === "intelligence"  && <PricingIntelligenceTab products={products} />}
    </div>
  );
}
