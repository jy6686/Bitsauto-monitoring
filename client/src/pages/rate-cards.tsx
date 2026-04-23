
import { useState, useRef, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CreditCard, Upload, Trash2, RefreshCw, Plus, FileText,
  ChevronDown, ChevronRight, PenLine, Download, Send,
  CheckCircle, XCircle, AlertTriangle, Loader2, ShieldCheck,
  Building2, Wallet, Database, MapPin, ScanSearch, Globe,
  Search, ArrowUpDown, Ban, Package, CloudUpload, FilePlus2,
  FileX2, TrendingDown, TrendingUp, Minus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type RateCard = {
  id: number;
  vendorName: string;
  name: string;
  cardType: string;
  currency: string;
  effectiveDate: string | null;
  entryCount: number;
  createdAt: string;
  sippyTariffId: number | null;
};

type RateCardEntry = {
  id: number;
  rateCardId: number;
  prefix: string;
  country: string | null;
  breakout: string | null;
  ratePerMin: number;
};

type ClientProfile = { id: number; name: string; type: string };
type SippyTariff   = { iTariff: number; name: string; currency?: string; iTariffType?: number };

type RateCardContextClient = {
  iCustomer: number; name: string; baseCurrency: string;
  iTariff: number | null; tariffName: string | null; tariffCurrency: string | null;
};
type RateCardContextDestSet = { iDestinationSet: number; name: string; currency: string };
type RateCardContextVendor  = { iVendor: number; name: string; baseCurrency: string | null };
type RateCardContext = {
  clients: RateCardContextClient[]; destSets: RateCardContextDestSet[]; vendors: RateCardContextVendor[];
};

type PushJob = {
  status: 'running' | 'done' | 'error';
  pushed: number; failed: number; total: number;
  startedAt: string; message?: string;
};
type VerifyResult = {
  localTotal: number; sippyFetched: number;
  matched: number; mismatched: number; localOnly: number; sippyOnly: number;
  mismatchSample: { prefix: string; local: number; sippy: number; match: boolean }[];
};

// Sippy live types
type SippyTariffRow  = { iTariff: number; name: string; currency: string };
type SippyDestSetRow = { iDestinationSet: number; name: string; currency: string; isVendorFallback?: boolean };
type SippyRate       = { prefix: string; destination: string; rate: number; effectiveFrom: string; effectiveTill: string };
type SippyRoute      = {
  prefix: string; price1: number | null; priceN: number | null;
  interval1: number | null; intervalN: number | null; forbidden: boolean | null;
  activationDate: string | null; expirationDate: string | null;
};

const CUSTOM_VENDOR = "__custom__";

// ── Sippy Tariff Rate Row (lazy loaded) ───────────────────────────────────────
function TariffRatesPanel({ iTariff, search }: { iTariff: number; search: string }) {
  const { data, isLoading, error } = useQuery<{ rates: SippyRate[]; error?: string }>({
    queryKey: ['/api/sippy/tariff-rates', iTariff],
    queryFn: () => fetch(`/api/sippy/tariff-rates?iTariff=${iTariff}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const q = search.trim().toLowerCase();
  const rates = (data?.rates ?? []).filter(r =>
    !q || r.prefix.startsWith(q) || r.destination.toLowerCase().includes(q)
  );
  if (isLoading) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 px-4">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading rates from Sippy…
    </div>
  );
  if (data?.error) return (
    <div className="px-4 py-3 text-xs text-red-400 flex items-center gap-2">
      <XCircle className="h-3.5 w-3.5" />{data.error}
    </div>
  );
  if (!rates.length) return (
    <div className="px-4 py-3 text-xs text-muted-foreground">{q ? 'No rates match the search.' : 'No rates in this tariff.'}</div>
  );
  return (
    <div className="overflow-x-auto max-h-72 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background/95 backdrop-blur-sm">
          <tr className="text-muted-foreground border-b border-amber-500/10">
            <th className="px-4 py-1.5 text-left font-medium">Prefix</th>
            <th className="px-4 py-1.5 text-left font-medium">Destination</th>
            <th className="px-4 py-1.5 text-right font-medium">Rate/min</th>
            <th className="px-4 py-1.5 text-left font-medium">Effective From</th>
            <th className="px-4 py-1.5 text-left font-medium">Effective Till</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r, i) => (
            <tr key={i} className="border-b border-amber-500/5 hover:bg-amber-500/5 transition-colors">
              <td className="px-4 py-1.5 font-mono">{r.prefix}</td>
              <td className="px-4 py-1.5 text-muted-foreground">{r.destination || '—'}</td>
              <td className="px-4 py-1.5 text-right font-mono text-amber-300">{r.rate.toFixed(4)}</td>
              <td className="px-4 py-1.5 text-muted-foreground">{r.effectiveFrom || '—'}</td>
              <td className="px-4 py-1.5 text-muted-foreground">{r.effectiveTill || 'No expiry'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-1.5 text-xs text-muted-foreground border-t border-amber-500/10">
        {rates.length} rate{rates.length !== 1 ? 's' : ''}{q ? ` matching "${q}"` : ''} {data && data.rates.length > rates.length ? `(filtered from ${data.rates.length})` : ''}
      </div>
    </div>
  );
}

// ── Sippy Destination Set Routes Panel (lazy loaded) ─────────────────────────
function DestSetRoutesPanel({ iDestinationSet, search, isVendorFallback }: { iDestinationSet: number; search: string; isVendorFallback?: boolean }) {
  const { data, isLoading } = useQuery<{ success: boolean; list: SippyRoute[]; message?: string }>({
    queryKey: ['/api/sippy/destination-sets', iDestinationSet, 'routes'],
    queryFn: () => fetch(`/api/sippy/destination-sets/${iDestinationSet}/routes`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    enabled: !isVendorFallback,
  });
  if (isVendorFallback) return (
    <div className="px-4 py-4 text-xs text-muted-foreground flex items-center gap-2">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      Per-prefix rates require Sippy Destination Sets (Sippy 2024+). This Sippy instance shows vendors only.
    </div>
  );
  const q = search.trim().toLowerCase();
  const routes = (data?.list ?? []).filter(r => !q || r.prefix.startsWith(q));
  if (isLoading) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 px-4">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading routes from Sippy…
    </div>
  );
  if (data && !data.success && !data.list?.length) return (
    <div className="px-4 py-3 text-xs text-red-400 flex items-center gap-2">
      <XCircle className="h-3.5 w-3.5" />{data.message || 'Failed to load routes'}
    </div>
  );
  if (!routes.length) return (
    <div className="px-4 py-3 text-xs text-muted-foreground">{q ? 'No routes match the search.' : 'No routes in this destination set.'}</div>
  );
  return (
    <div className="overflow-x-auto max-h-72 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background/95 backdrop-blur-sm">
          <tr className="text-muted-foreground border-b border-cyan-500/10">
            <th className="px-4 py-1.5 text-left font-medium">Prefix</th>
            <th className="px-4 py-1.5 text-right font-medium">Rate/min</th>
            <th className="px-4 py-1.5 text-right font-medium">Interval 1s</th>
            <th className="px-4 py-1.5 text-right font-medium">Interval Ns</th>
            <th className="px-4 py-1.5 text-center font-medium">Status</th>
            <th className="px-4 py-1.5 text-left font-medium">Expires</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r, i) => (
            <tr key={i} className="border-b border-cyan-500/5 hover:bg-cyan-500/5 transition-colors">
              <td className="px-4 py-1.5 font-mono">{r.prefix}</td>
              <td className="px-4 py-1.5 text-right font-mono text-cyan-300">
                {r.price1 !== null && r.price1 !== undefined ? r.price1.toFixed(4) : '—'}
              </td>
              <td className="px-4 py-1.5 text-right text-muted-foreground">{r.interval1 ?? '—'}</td>
              <td className="px-4 py-1.5 text-right text-muted-foreground">{r.intervalN ?? '—'}</td>
              <td className="px-4 py-1.5 text-center">
                {r.forbidden ? (
                  <span className="inline-flex items-center gap-1 text-red-400"><Ban className="h-3 w-3" />Blocked</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle className="h-3 w-3" />Active</span>
                )}
              </td>
              <td className="px-4 py-1.5 text-muted-foreground">{r.expirationDate || 'No expiry'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-1.5 text-xs text-muted-foreground border-t border-cyan-500/10">
        {routes.length} route{routes.length !== 1 ? 's' : ''}{q ? ` matching "${q}"` : ''} {data && data.list.length > routes.length ? `(filtered from ${data.list.length})` : ''}
      </div>
    </div>
  );
}

// ── Sippy Tariffs Live Browser (Client) ───────────────────────────────────────
function SippyClientBrowser() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [rateSearch, setRateSearch] = useState('');

  const { data: tariffRaw = [], isLoading, refetch } = useQuery<SippyTariff[]>({
    queryKey: ['/api/sippy/tariffs'],
    queryFn: () => fetch('/api/sippy/tariffs').then(r => r.json()).then(d => Array.isArray(d) ? d : Array.isArray(d?.tariffs) ? d.tariffs : []),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const tariffs: SippyTariffRow[] = tariffRaw.map((t: any) => ({
    iTariff: t.iTariff ?? t.id,
    name: t.name,
    currency: t.currency ?? 'USD',
  }));

  const q = search.trim().toLowerCase();
  const filtered = q ? tariffs.filter(t => t.name.toLowerCase().includes(q) || String(t.iTariff).includes(q)) : tariffs;

  return (
    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-500/15 flex-wrap gap-y-2">
        <Building2 className="h-4 w-4 text-amber-400 shrink-0" />
        <span className="text-sm font-semibold text-amber-300">Sippy Client Tariffs</span>
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />
        ) : (
          <Badge className="bg-amber-500/20 text-amber-400 border-0 text-xs">{filtered.length} tariff{filtered.length !== 1 ? 's' : ''}</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search tariffs…" className="h-7 pl-7 pr-2 text-xs w-44"
              data-testid="input-tariff-search"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />Loading tariffs from Sippy…
        </div>
      ) : !filtered.length ? (
        <div className="text-sm text-muted-foreground p-6 text-center">
          {q ? `No tariffs matching "${q}"` : 'No tariffs found in Sippy.'}
        </div>
      ) : (
        <div className="divide-y divide-amber-500/10">
          {filtered.map(t => {
            const isOpen = expandedId === t.iTariff;
            return (
              <div key={t.iTariff}>
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-500/5 transition-colors text-left"
                  onClick={() => { setExpandedId(isOpen ? null : t.iTariff); setRateSearch(''); }}
                  data-testid={`row-tariff-${t.iTariff}`}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-amber-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{t.name}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-auto shrink-0">
                    <Badge variant="outline" className="text-xs font-mono border-amber-500/30 text-amber-400">{t.currency}</Badge>
                    <span className="text-xs text-muted-foreground font-mono">ID {t.iTariff}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-amber-500/10 bg-background/40">
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-500/10">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={rateSearch} onChange={e => setRateSearch(e.target.value)}
                        placeholder="Filter by prefix or destination…" className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0"
                        data-testid="input-rate-search"
                      />
                    </div>
                    <TariffRatesPanel iTariff={t.iTariff} search={rateSearch} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sippy Destination Sets Live Browser (Vendor) ──────────────────────────────
function SippyVendorBrowser() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [routeSearch, setRouteSearch] = useState('');

  const { data, isLoading, refetch } = useQuery<{ success: boolean; list: any[]; message?: string; vendorFallback?: boolean }>({
    queryKey: ['/api/sippy/destination-sets'],
    queryFn: () => fetch('/api/sippy/destination-sets?limit=500').then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const isVendorFallback = data?.vendorFallback ?? false;
  const sets: SippyDestSetRow[] = (data?.list ?? []).map((d: any) => ({
    iDestinationSet:  d.iDestinationSet,
    name:             d.name,
    currency:         d.iso4217 ?? d.currency ?? 'USD',
    isVendorFallback: d.isVendorFallback ?? false,
  }));
  const q = search.trim().toLowerCase();
  const filtered = q ? sets.filter(s => s.name.toLowerCase().includes(q) || String(s.iDestinationSet).includes(q)) : sets;

  return (
    <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-cyan-500/15 flex-wrap gap-y-2">
        <Wallet className="h-4 w-4 text-cyan-400 shrink-0" />
        <span className="text-sm font-semibold text-cyan-300">
          {isVendorFallback ? 'Sippy Vendors' : 'Sippy Vendor Destination Sets'}
        </span>
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />
        ) : (
          <Badge className="bg-cyan-500/20 text-cyan-400 border-0 text-xs">{filtered.length} {isVendorFallback ? 'vendor' : 'set'}{filtered.length !== 1 ? 's' : ''}</Badge>
        )}
        {isVendorFallback && !isLoading && (
          <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30 gap-1">
            <AlertTriangle className="h-3 w-3" />Sippy 2024+ not detected — showing vendors
          </Badge>
        )}
        {data && !data.success && !sets.length && <span className="text-xs text-red-400 ml-2">{data.message ?? 'Failed to load'}</span>}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder={isVendorFallback ? 'Search vendors…' : 'Search destination sets…'} className="h-7 pl-7 pr-2 text-xs w-48"
              data-testid="input-destset-search"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />Loading from Sippy…
        </div>
      ) : !filtered.length ? (
        <div className="text-sm text-muted-foreground p-6 text-center">
          {q ? `No ${isVendorFallback ? 'vendors' : 'destination sets'} matching "${q}"` : `No ${isVendorFallback ? 'vendors' : 'destination sets'} found in Sippy.`}
        </div>
      ) : (
        <div className="divide-y divide-cyan-500/10">
          {filtered.map(s => {
            const isOpen = expandedId === s.iDestinationSet;
            return (
              <div key={s.iDestinationSet}>
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-cyan-500/5 transition-colors text-left"
                  onClick={() => { setExpandedId(isOpen ? null : s.iDestinationSet); setRouteSearch(''); }}
                  data-testid={`row-destset-${s.iDestinationSet}`}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-cyan-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-auto shrink-0">
                    <Badge variant="outline" className="text-xs font-mono border-cyan-500/30 text-cyan-400">{s.currency || 'USD'}</Badge>
                    <span className="text-xs text-muted-foreground font-mono">ID {s.iDestinationSet}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-cyan-500/10 bg-background/40">
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-cyan-500/10">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={routeSearch} onChange={e => setRouteSearch(e.target.value)}
                        placeholder="Filter by prefix…" className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0"
                        data-testid="input-route-search"
                      />
                    </div>
                    <DestSetRoutesPanel iDestinationSet={s.iDestinationSet} search={routeSearch} isVendorFallback={s.isVendorFallback} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function RateCardsPage() {
  const { toast } = useToast();
  const search = useSearch();
  const typeParam = new URLSearchParams(search).get('type');
  const activeType: 'client' | 'vendor' | null =
    typeParam === 'client' ? 'client' : typeParam === 'vendor' ? 'vendor' : null;

  const [showLocal, setShowLocal] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<number | null>(null);
  const [entrySearch, setEntrySearch]       = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const [selectedVendor, setSelectedVendor]           = useState('');
  const [customVendor, setCustomVendor]               = useState('');
  const [newName, setNewName]                         = useState('');
  const [newCurrency, setNewCurrency]                 = useState('USD');
  const [newDate, setNewDate]                         = useState('');
  const [selectedSippyTariff, setSelectedSippyTariff] = useState<SippyTariff | null>(null);
  const [nameManual, setNameManual]                   = useState(false);

  const [diffCardId, setDiffCardId]     = useState<number | null>(null);
  const [diffFile, setDiffFile]         = useState<File | null>(null);
  const [diffData, setDiffData]         = useState<{ added: number; removed: number; changed: number; unchanged: number; changes: any } | null>(null);
  const [diffLoading, setDiffLoading]   = useState(false);
  const diffInputRef = useRef<HTMLInputElement>(null);

  // ── Bulk import dialog state ──────────────────────────────────────────────
  type DiffResult = { added: number; removed: number; changed: number; unchanged: number; changes: { added: any[]; removed: any[]; changed: any[] } };
  const [importCard, setImportCard]     = useState<RateCard | null>(null);
  const [importFile, setImportFile]     = useState<File | null>(null);
  const [importStep, setImportStep]     = useState<'drop' | 'diffing' | 'preview'>('drop');
  const [importDiff, setImportDiff]     = useState<DiffResult | null>(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const [importDetailTab, setImportDetailTab] = useState<'changed' | 'added' | 'removed'>('changed');
  const importBrowseRef = useRef<HTMLInputElement>(null);

  const [pushCard, setPushCard]         = useState<RateCard | null>(null);
  const [pushTariffId, setPushTariffId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [jobId, setJobId]               = useState<string | null>(null);
  const [jobData, setJobData]           = useState<PushJob | null>(null);
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [verifyCard, setVerifyCard]         = useState<RateCard | null>(null);
  const [verifyTariffId, setVerifyTariffId] = useState('');
  const [verifyResult, setVerifyResult]     = useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading]   = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: cards = [], isLoading: cardsLoading, refetch: refetchCards } = useQuery<RateCard[]>({
    queryKey: ["/api/rate-cards"], refetchOnWindowFocus: false,
  });
  const { data: clients = [] } = useQuery<ClientProfile[]>({
    queryKey: ["/api/clients"], refetchOnWindowFocus: false,
  });
  const { data: entries = [], isFetching: entriesLoading } = useQuery<RateCardEntry[]>({
    queryKey: ["/api/rate-cards", expandedCardId, "entries"],
    queryFn: () => fetch(`/api/rate-cards/${expandedCardId}/entries`).then(r => r.json()),
    enabled: expandedCardId !== null,
  });
  const { data: sippyTariffs = [], isLoading: tariffsLoading } = useQuery<SippyTariff[]>({
    queryKey: ["/api/sippy/tariffs"],
    queryFn: () => fetch('/api/sippy/tariffs').then(r => r.json()).then(d => Array.isArray(d) ? d : Array.isArray(d?.tariffs) ? d.tariffs : []),
    refetchOnWindowFocus: false,
    enabled: !!(pushCard || verifyCard || createOpen),
  });
  const { data: rcCtx } = useQuery<RateCardContext>({
    queryKey: ["/api/sippy/rate-card-context"],
    queryFn: () => fetch('/api/sippy/rate-card-context').then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/rate-cards", data).then(r => r.json()),
    onSuccess: () => {
      setCreateOpen(false);
      setSelectedVendor(''); setCustomVendor(''); setNewName(''); setNewCurrency('USD'); setNewDate('');
      setSelectedSippyTariff(null); setNameManual(false);
      queryClient.invalidateQueries({ queryKey: ["/api/rate-cards"] });
      toast({ title: "Rate card created" });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/rate-cards/${id}`).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/rate-cards"] }); toast({ title: "Rate card deleted" }); },
  });
  const uploadMutation = useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.type.includes('spreadsheet') || file.type.includes('excel');
      const body = isExcel ? await file.arrayBuffer() : await file.text();
      const contentType = isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/plain';
      const res = await fetch(`/api/rate-cards/${id}/upload`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Upload failed'); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rate-cards"] });
      toast({ title: `Imported ${data.inserted} entries` });
      setUploadCardId(null);
    },
    onError: (err: Error) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  // ── Job polling ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    jobPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/rate-cards/push-jobs/${jobId}`);
        if (!r.ok) return;
        const job: PushJob = await r.json();
        setJobData(job);
        if (job.status !== 'running') {
          clearInterval(jobPollRef.current!);
          queryClient.invalidateQueries({ queryKey: ["/api/rate-cards"] });
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(jobPollRef.current!);
  }, [jobId]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const vendorOptions = clients.map(c => c.name);
  const entryQ = entrySearch.trim().toLowerCase();
  const filteredEntries = entryQ
    ? entries.filter(e => e.prefix.startsWith(entryQ) || (e.country ?? '').toLowerCase().includes(entryQ) || (e.breakout ?? '').toLowerCase().includes(entryQ))
    : entries;
  const shownEntries = filteredEntries.slice(0, 500);
  const resolvedVendorName = vendorOptions.length === 0
    ? customVendor
    : selectedVendor === CUSTOM_VENDOR ? customVendor : selectedVendor;
  const canCreate = resolvedVendorName.trim() && newName.trim() && !createMutation.isPending;
  const matchedSippyClient = (activeType === 'client' && resolvedVendorName.trim())
    ? (rcCtx?.clients?.find(c => c.name.toLowerCase() === resolvedVendorName.trim().toLowerCase()) ?? null)
    : null;

  function handleSubmitCreate() {
    createMutation.mutate({
      vendorName: resolvedVendorName.trim(), name: newName.trim(),
      cardType: activeType ?? 'vendor', currency: newCurrency || 'USD',
      effectiveDate: newDate || null,
      sippyTariffId: selectedSippyTariff ? selectedSippyTariff.iTariff : null,
    });
  }

  const visibleCards = activeType ? cards.filter(c => (c.cardType ?? 'vendor') === activeType) : cards;

  async function handleDiffPreview(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || diffCardId === null) return;
    e.target.value = '';
    setDiffFile(file);
    setDiffLoading(true);
    setDiffData(null);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const entries: Array<{ prefix: string; ratePerMin: number; country?: string; breakout?: string; originPrefix?: string }> = [];
      const headerLine = lines[0]?.toLowerCase() ?? '';
      const hasHeader = /prefix|destination|country/.test(headerLine);
      for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
        const cols = lines[i].split(/[,\t;]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length < 2) continue;
        const prefix = cols[0].replace(/\D/g, '');
        const rateRaw = parseFloat(cols[1]);
        if (!prefix || isNaN(rateRaw)) continue;
        entries.push({ prefix, ratePerMin: rateRaw, country: cols[2] ?? undefined, breakout: cols[3] ?? undefined, originPrefix: cols[4] ?? undefined });
      }
      const res = await fetch(`/api/rate-cards/${diffCardId}/diff`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error('Diff failed');
      const data = await res.json();
      setDiffData(data);
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
      setDiffCardId(null);
    } finally {
      setDiffLoading(false);
    }
  }

  function confirmDiffUpload() {
    if (diffFile && diffCardId !== null) {
      uploadMutation.mutate({ id: diffCardId, file: diffFile });
      setDiffData(null);
      setDiffCardId(null);
      setDiffFile(null);
    }
  }

  // ── Bulk import dialog helpers ────────────────────────────────────────────
  function resetImportDialog() {
    setImportCard(null);
    setImportFile(null);
    setImportStep('drop');
    setImportDiff(null);
    setImportDragOver(false);
    setImportDetailTab('changed');
  }

  async function runImportDiff(file: File, cardId: number) {
    setImportFile(file);
    setImportStep('diffing');
    setImportDiff(null);
    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name) || file.type.includes('spreadsheet') || file.type.includes('excel');
      let entries: Array<{ prefix: string; ratePerMin: number; country?: string; breakout?: string; originPrefix?: string }> = [];

      if (isExcel) {
        const buf = await file.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (jsonRows.length > 1) {
          const rawHdr = (jsonRows[0] as any[]).map((h: any) => String(h).toLowerCase().trim());
          const pIdx = rawHdr.findIndex(h => h.includes('prefix') || h === 'code' || h === 'dial_code');
          const rIdx = rawHdr.findIndex(h => h.includes('rate') || h.includes('price') || h.includes('cost') || h === 'sell_rate');
          const cIdx = rawHdr.findIndex(h => h.includes('country') || h.includes('destination') || h === 'name');
          const bIdx = rawHdr.findIndex(h => h.includes('breakout') || h.includes('description') || h.includes('desc'));
          if (pIdx !== -1 && rIdx !== -1) {
            for (let i = 1; i < jsonRows.length; i++) {
              const row = jsonRows[i] as any[];
              const prefix = String(row[pIdx] ?? '').replace(/\D/g, '');
              const rate = parseFloat(String(row[rIdx] ?? '').replace(/[^0-9.]/g, ''));
              if (!prefix || isNaN(rate)) continue;
              entries.push({ prefix, ratePerMin: rate, country: cIdx >= 0 ? String(row[cIdx] ?? '') || undefined : undefined, breakout: bIdx >= 0 ? String(row[bIdx] ?? '') || undefined : undefined });
            }
          }
        }
      } else {
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        const headerLine = lines[0]?.toLowerCase() ?? '';
        const hasHeader = /prefix|destination|country|rate/.test(headerLine);
        for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
          const cols = lines[i].split(/[,\t;]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
          if (cols.length < 2) continue;
          const prefix = cols[0].replace(/\D/g, '');
          const rate = parseFloat(cols[1]);
          if (!prefix || isNaN(rate)) continue;
          entries.push({ prefix, ratePerMin: rate, country: cols[2] || undefined, breakout: cols[3] || undefined, originPrefix: cols[4] || undefined });
        }
      }

      if (entries.length === 0) throw new Error('No valid rows found. Expected columns: prefix, rate (and optionally country, breakout).');

      const res = await fetch(`/api/rate-cards/${cardId}/diff`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error('Diff comparison failed');
      const data = await res.json();
      setImportDiff(data);
      setImportStep('preview');
      const preferTab = data.changes?.changed?.length > 0 ? 'changed' : data.changes?.added?.length > 0 ? 'added' : 'removed';
      setImportDetailTab(preferTab as any);
    } catch (err: any) {
      toast({ title: 'Preview failed', description: err.message, variant: 'destructive' });
      setImportStep('drop');
      setImportFile(null);
    }
  }

  const handleImportDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setImportDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && importCard) runImportDiff(file, importCard.id);
  }, [importCard]);

  const handleImportBrowse = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && importCard) runImportDiff(file, importCard.id);
  }, [importCard]);

  function confirmImport() {
    if (importFile && importCard) {
      uploadMutation.mutate({ id: importCard.id, file: importFile });
      resetImportDialog();
    }
  }

  async function startPush() {
    if (!pushCard || !pushTariffId) return;
    setJobData(null); setJobId(null);
    const isVendor = pushCard.cardType === 'vendor';
    const endpoint = isVendor ? `/api/rate-cards/${pushCard.id}/push-to-destset` : `/api/rate-cards/${pushCard.id}/push-to-sippy`;
    const body = isVendor
      ? { destSetId: Number(pushTariffId), effectiveFrom: effectiveFrom || undefined }
      : { tariffId: pushTariffId, effectiveFrom: effectiveFrom || undefined };
    const r = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) { toast({ title: "Push failed", description: data.message, variant: "destructive" }); return; }
    setJobId(data.jobId);
    setJobData({ status: 'running', pushed: 0, failed: 0, total: data.total, startedAt: new Date().toISOString() });
  }

  async function runVerify() {
    if (!verifyCard || !verifyTariffId) return;
    setVerifyLoading(true); setVerifyResult(null);
    try {
      const isVendor = verifyCard.cardType === 'vendor';
      const param = isVendor ? `destSetId=${verifyTariffId}` : `tariffId=${verifyTariffId}`;
      const r = await fetch(`/api/rate-cards/${verifyCard.id}/verify-sippy?${param}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      setVerifyResult(data);
    } catch (err: any) { toast({ title: "Verify failed", description: err.message, variant: "destructive" }); }
    setVerifyLoading(false);
  }

  const pushProgress = jobData ? Math.round(((jobData.pushed + jobData.failed) / jobData.total) * 100) : 0;

  const typeConfig = {
    client: { label: 'Client Rate Cards', icon: Building2, iconColor: 'text-amber-400', desc: 'Rates charged to clients — fetched live from Sippy tariffs' },
    vendor: { label: 'Vendor Rate Cards', icon: Wallet, iconColor: 'text-cyan-400', desc: 'Buy-rates from vendors — fetched live from Sippy destination sets' },
    all:    { label: 'Rate Cards', icon: CreditCard, iconColor: 'text-emerald-400', desc: 'Live rates from Sippy tariffs and destination sets' },
  };
  const tc = activeType ? typeConfig[activeType] : typeConfig.all;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <tc.icon className={`h-6 w-6 ${tc.iconColor}`} />
            {tc.label}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{tc.desc}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm" onClick={() => setShowLocal(v => !v)}
            data-testid="button-toggle-local" className="gap-1.5"
          >
            <Database className="h-3.5 w-3.5" />
            {showLocal ? 'Hide Local Cards' : 'Local Rate Cards'}
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-ratecard" className="gap-1.5" onClick={() => setShowLocal(true)}>
                <Plus className="h-3.5 w-3.5" />New Local Card
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {activeType === 'client'
                    ? <><Building2 className="h-4 w-4 text-amber-400" />Create Client Rate Card</>
                    : <><Wallet className="h-4 w-4 text-cyan-400" />Create Vendor Rate Card</>
                  }
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Vendor / Client</Label>
                  {vendorOptions.length > 0 ? (
                    <>
                      <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                        <SelectTrigger data-testid="trigger-vendor-select"><SelectValue placeholder="Select a vendor or client…" /></SelectTrigger>
                        <SelectContent>
                          {vendorOptions.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                          <SelectItem value={CUSTOM_VENDOR}>
                            <span className="flex items-center gap-1.5 text-muted-foreground"><PenLine className="h-3.5 w-3.5" />Enter manually…</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {selectedVendor === CUSTOM_VENDOR && (
                        <Input className="mt-2" value={customVendor} onChange={e => setCustomVendor(e.target.value)} placeholder="e.g. Callntalk" data-testid="input-custom-vendor" autoFocus />
                      )}
                    </>
                  ) : (
                    <Input value={customVendor} onChange={e => setCustomVendor(e.target.value)} placeholder="e.g. Callntalk" data-testid="input-vendor-name" />
                  )}
                </div>
                {matchedSippyClient && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
                    <Building2 className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-amber-300 font-medium">Sippy match found</span>
                      <div className="text-muted-foreground mt-0.5">
                        {matchedSippyClient.tariffName
                          ? <>Assigned tariff: <span className="text-amber-300 font-medium">{matchedSippyClient.tariffName}</span> (ID: {matchedSippyClient.iTariff})</>
                          : 'No tariff assigned in Sippy yet'
                        }
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Rate Card Name (Sippy Tariff)</Label>
                  {tariffsLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading tariffs from Sippy…
                    </div>
                  ) : !nameManual ? (
                    <>
                      <Select
                        value={selectedSippyTariff ? String(selectedSippyTariff.iTariff) : ''}
                        onValueChange={val => {
                          if (val === '__manual__') { setSelectedSippyTariff(null); setNameManual(true); return; }
                          const t = sippyTariffs.find(x => String(x.iTariff) === val) ?? null;
                          setSelectedSippyTariff(t);
                          if (t) { setNewName(t.name); if (t.currency) setNewCurrency(t.currency); }
                        }}
                      >
                        <SelectTrigger data-testid="select-sippy-tariff-create">
                          <SelectValue placeholder={sippyTariffs.length ? "Select Sippy tariff…" : "No tariffs available"} />
                        </SelectTrigger>
                        <SelectContent>
                          {sippyTariffs.map(t => (
                            <SelectItem key={t.iTariff} value={String(t.iTariff)}>
                              {t.name}{t.currency ? ` (${t.currency})` : ''}{t.iTariffType !== undefined ? ` · ID ${t.iTariff}` : ''}
                            </SelectItem>
                          ))}
                          <SelectItem value="__manual__">
                            <span className="flex items-center gap-1.5 text-muted-foreground"><PenLine className="h-3.5 w-3.5" />Enter name manually…</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {selectedSippyTariff && (
                        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-400">
                          <CheckCircle className="h-3 w-3" />
                          Linked to Sippy tariff ID <span className="font-mono">{selectedSippyTariff.iTariff}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Q2 2026 Standard Rates" data-testid="input-card-name" autoFocus />
                      <button onClick={() => { setNameManual(false); setNewName(''); }} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                        Pick from Sippy instead
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Currency</Label>
                    <Input value={newCurrency} onChange={e => setNewCurrency(e.target.value)} placeholder="USD" data-testid="input-currency" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Effective Date</Label>
                    <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} data-testid="input-effective-date" />
                  </div>
                </div>
                <Button className="w-full" onClick={handleSubmitCreate} disabled={!canCreate} data-testid="button-submit-ratecard">
                  {createMutation.isPending ? "Creating…" : "Create Rate Card"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Sippy Live Browser ──────────────────────────────────────────────── */}
      {(activeType === 'client' || activeType === null) && <SippyClientBrowser />}
      {(activeType === 'vendor' || activeType === null) && <SippyVendorBrowser />}

      {/* ── Local Rate Cards (toggle) ────────────────────────────────────────── */}
      {showLocal && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Local Rate Cards</h2>
            <span className="text-xs text-muted-foreground">(CSV uploads for push-to-Sippy and LCR analysis)</span>
          </div>

          {/* Format hint */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3 items-start">
            <FileText className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="text-blue-300 font-medium mb-1">CSV &amp; Excel Upload Format</div>
              <div className="text-muted-foreground text-xs font-mono">prefix, country, breakout, rate</div>
              <div className="text-muted-foreground text-xs font-mono mt-0.5">252, Somalia, Africa, 0.1250</div>
              <div className="text-muted-foreground text-xs mt-1">
                Accepts <span className="text-blue-300 font-medium">.csv</span> or <span className="text-blue-300 font-medium">.xlsx</span>
              </div>
            </div>
          </div>

          {/* Hidden browse input for bulk import dialog */}
          <input ref={importBrowseRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImportBrowse} data-testid="file-upload-input" />

          {/* ── Bulk Import Dialog ───────────────────────────────────────────── */}
          <Dialog open={!!importCard} onOpenChange={o => { if (!o) resetImportDialog(); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CloudUpload className="h-4 w-4 text-blue-400" />
                  Import Rate Sheet
                  {importCard && <span className="text-muted-foreground font-normal text-sm ml-1">— {importCard.vendorName} · {importCard.name}</span>}
                </DialogTitle>
              </DialogHeader>

              {/* Step: drop zone */}
              {importStep === 'drop' && (
                <div
                  className={`relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-12 text-center transition-colors cursor-pointer ${importDragOver ? 'border-blue-400 bg-blue-500/10' : 'border-border hover:border-blue-400/60 hover:bg-muted/30'}`}
                  onDragOver={e => { e.preventDefault(); setImportDragOver(true); }}
                  onDragLeave={() => setImportDragOver(false)}
                  onDrop={handleImportDrop}
                  onClick={() => importBrowseRef.current?.click()}
                  data-testid="dropzone-import"
                >
                  <CloudUpload className={`h-12 w-12 transition-colors ${importDragOver ? 'text-blue-400' : 'text-muted-foreground/50'}`} />
                  <div>
                    <p className="text-base font-medium">{importDragOver ? 'Release to preview…' : 'Drag & drop your rate sheet here'}</p>
                    <p className="text-sm text-muted-foreground mt-1">or <span className="text-blue-400 underline underline-offset-2">click to browse</span></p>
                    <p className="text-xs text-muted-foreground mt-3 font-mono">Accepts .csv · .xlsx · .xls</p>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">Expected columns: prefix, rate [, country, breakout]</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 w-full mt-2 max-w-xs text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5 bg-muted/30 rounded-lg px-2 py-1.5"><FilePlus2 className="h-3 w-3 text-emerald-400" />New prefixes</div>
                    <div className="flex items-center gap-1.5 bg-muted/30 rounded-lg px-2 py-1.5"><TrendingDown className="h-3 w-3 text-amber-400" />Rate changes</div>
                    <div className="flex items-center gap-1.5 bg-muted/30 rounded-lg px-2 py-1.5"><FileX2 className="h-3 w-3 text-rose-400" />Removals</div>
                  </div>
                </div>
              )}

              {/* Step: diffing (loading) */}
              {importStep === 'diffing' && (
                <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                  <div className="text-center">
                    <p className="font-medium">Analysing changes…</p>
                    <p className="text-sm mt-1 text-muted-foreground/70">{importFile?.name}</p>
                  </div>
                </div>
              )}

              {/* Step: diff preview */}
              {importStep === 'preview' && importDiff && (
                <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
                  {/* File info bar */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
                    <FileText className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{importFile?.name}</span>
                    <span className="ml-auto">{((importFile?.size ?? 0) / 1024).toFixed(1)} KB</span>
                    <button
                      className="text-blue-400 hover:text-blue-300 ml-2 underline underline-offset-2"
                      onClick={() => { setImportStep('drop'); setImportFile(null); setImportDiff(null); }}
                      data-testid="button-replace-file"
                    >Replace file</button>
                  </div>

                  {/* KPI cards */}
                  <div className="grid grid-cols-4 gap-2 shrink-0">
                    <button
                      className={`rounded-xl p-3 text-center border transition-colors ${importDetailTab === 'added' ? 'border-emerald-500 bg-emerald-500/15' : 'border-emerald-500/20 bg-emerald-500/8 hover:border-emerald-500/50'}`}
                      onClick={() => setImportDetailTab('added')}
                      data-testid="text-diff-added"
                    >
                      <FilePlus2 className="h-4 w-4 text-emerald-400 mx-auto mb-1" />
                      <p className="text-2xl font-bold text-emerald-400">{importDiff.added}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">New</p>
                    </button>
                    <button
                      className={`rounded-xl p-3 text-center border transition-colors ${importDetailTab === 'changed' ? 'border-amber-500 bg-amber-500/15' : 'border-amber-500/20 bg-amber-500/8 hover:border-amber-500/50'}`}
                      onClick={() => setImportDetailTab('changed')}
                      data-testid="text-diff-changed"
                    >
                      <TrendingDown className="h-4 w-4 text-amber-400 mx-auto mb-1" />
                      <p className="text-2xl font-bold text-amber-400">{importDiff.changed}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Changed</p>
                    </button>
                    <button
                      className={`rounded-xl p-3 text-center border transition-colors ${importDetailTab === 'removed' ? 'border-rose-500 bg-rose-500/15' : 'border-rose-500/20 bg-rose-500/8 hover:border-rose-500/50'}`}
                      onClick={() => setImportDetailTab('removed')}
                      data-testid="text-diff-removed"
                    >
                      <FileX2 className="h-4 w-4 text-rose-400 mx-auto mb-1" />
                      <p className="text-2xl font-bold text-rose-400">{importDiff.removed}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Removed</p>
                    </button>
                    <div className="rounded-xl p-3 text-center border border-border/40 bg-muted/10">
                      <Minus className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                      <p className="text-2xl font-bold text-muted-foreground" data-testid="text-diff-same">{importDiff.unchanged}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Unchanged</p>
                    </div>
                  </div>

                  {/* All-clear banner */}
                  {importDiff.added === 0 && importDiff.changed === 0 && importDiff.removed === 0 && (
                    <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3">
                      <CheckCircle className="h-4 w-4 shrink-0" />
                      No changes detected — this file is identical to the current rate sheet.
                    </div>
                  )}

                  {/* Detail tab content */}
                  {(importDiff.added > 0 || importDiff.changed > 0 || importDiff.removed > 0) && (
                    <div className="flex flex-col min-h-0 flex-1 rounded-xl border border-border/50 overflow-hidden">
                      {/* Tab bar */}
                      <div className="flex border-b border-border/50 bg-muted/20 shrink-0">
                        {importDiff.changed > 0 && (
                          <button className={`px-4 py-2.5 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${importDetailTab === 'changed' ? 'border-amber-400 text-amber-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setImportDetailTab('changed')} data-testid="tab-changed">
                            <TrendingDown className="h-3 w-3" />Changed ({importDiff.changed})
                          </button>
                        )}
                        {importDiff.added > 0 && (
                          <button className={`px-4 py-2.5 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${importDetailTab === 'added' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setImportDetailTab('added')} data-testid="tab-added">
                            <FilePlus2 className="h-3 w-3" />New ({importDiff.added})
                          </button>
                        )}
                        {importDiff.removed > 0 && (
                          <button className={`px-4 py-2.5 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${importDetailTab === 'removed' ? 'border-rose-400 text-rose-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setImportDetailTab('removed')} data-testid="tab-removed">
                            <FileX2 className="h-3 w-3" />Removed ({importDiff.removed})
                          </button>
                        )}
                      </div>

                      {/* Table body */}
                      <div className="overflow-y-auto flex-1" style={{ maxHeight: 240 }}>
                        {importDetailTab === 'changed' && importDiff.changes.changed.length > 0 && (
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-background/95 backdrop-blur-sm">
                              <tr className="text-muted-foreground border-b border-border/30">
                                <th className="px-3 py-2 text-left font-medium">Prefix</th>
                                <th className="px-3 py-2 text-left font-medium">Country</th>
                                <th className="px-3 py-2 text-right font-medium">Old Rate</th>
                                <th className="px-3 py-2 text-right font-medium">New Rate</th>
                                <th className="px-3 py-2 text-right font-medium">Δ</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                              {importDiff.changes.changed.slice(0, 500).map((c: any, i: number) => {
                                const delta = c.newRate - c.oldRate;
                                const pct = c.oldRate > 0 ? ((delta / c.oldRate) * 100) : 0;
                                return (
                                  <tr key={i} className="hover:bg-muted/20">
                                    <td className="px-3 py-1.5 font-mono text-foreground">+{c.prefix}</td>
                                    <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[100px]">{c.country || '—'}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{c.oldRate.toFixed(6)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono font-medium">{c.newRate.toFixed(6)}</td>
                                    <td className={`px-3 py-1.5 text-right font-mono font-semibold flex items-center justify-end gap-1 ${delta > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                      {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                      {delta > 0 ? '+' : ''}{pct.toFixed(1)}%
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                        {importDetailTab === 'added' && importDiff.changes.added.length > 0 && (
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-background/95 backdrop-blur-sm">
                              <tr className="text-muted-foreground border-b border-border/30">
                                <th className="px-3 py-2 text-left font-medium">Prefix</th>
                                <th className="px-3 py-2 text-left font-medium">Country</th>
                                <th className="px-3 py-2 text-left font-medium">Breakout</th>
                                <th className="px-3 py-2 text-right font-medium">Rate/min</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                              {importDiff.changes.added.slice(0, 500).map((r: any, i: number) => (
                                <tr key={i} className="hover:bg-muted/20">
                                  <td className="px-3 py-1.5 font-mono text-emerald-400">+{r.prefix}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{r.country || '—'}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{r.breakout || '—'}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{r.ratePerMin.toFixed(6)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {importDetailTab === 'removed' && importDiff.changes.removed.length > 0 && (
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-background/95 backdrop-blur-sm">
                              <tr className="text-muted-foreground border-b border-border/30">
                                <th className="px-3 py-2 text-left font-medium">Prefix</th>
                                <th className="px-3 py-2 text-left font-medium">Country</th>
                                <th className="px-3 py-2 text-left font-medium">Breakout</th>
                                <th className="px-3 py-2 text-right font-medium">Rate/min</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                              {importDiff.changes.removed.slice(0, 500).map((r: any, i: number) => (
                                <tr key={i} className="hover:bg-muted/20">
                                  <td className="px-3 py-1.5 font-mono text-rose-400">−{r.prefix}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{r.country || '—'}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{r.breakout || '—'}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{r.ratePerMin.toFixed(6)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {importDetailTab === 'changed' && importDiff.changes.changed.length > 500 && (
                          <p className="text-center text-xs text-muted-foreground py-2">Showing first 500 of {importDiff.changes.changed.length} changes</p>
                        )}
                        {importDetailTab === 'added' && importDiff.changes.added.length > 500 && (
                          <p className="text-center text-xs text-muted-foreground py-2">Showing first 500 of {importDiff.changes.added.length} new rows</p>
                        )}
                        {importDetailTab === 'removed' && importDiff.changes.removed.length > 500 && (
                          <p className="text-center text-xs text-muted-foreground py-2">Showing first 500 of {importDiff.changes.removed.length} removed rows</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action bar */}
                  <div className="flex justify-end gap-2 pt-1 shrink-0">
                    <Button variant="outline" size="sm" onClick={resetImportDialog} data-testid="button-cancel-import">Cancel</Button>
                    <Button size="sm" onClick={confirmImport} disabled={uploadMutation.isPending} data-testid="button-confirm-import" className="bg-blue-600 hover:bg-blue-500 text-white">
                      {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                      Confirm Import
                      {importDiff.added + importDiff.changed > 0 && <span className="ml-2 bg-white/20 rounded px-1.5 text-xs">{importDiff.added + importDiff.changed} changes</span>}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Cards list */}
          {cardsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />Loading local rate cards…
            </div>
          ) : visibleCards.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-8 text-center">
              <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No local rate cards yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Create one to upload CSV rates and push them to Sippy.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleCards.map(card => {
                const isExpanded = expandedCardId === card.id;
                return (
                  <div key={card.id} className="border border-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-card">
                      <button
                        onClick={() => setExpandedCardId(isExpanded ? null : card.id)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        data-testid={`row-local-card-${card.id}`}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <span className="font-medium text-sm truncate">{card.vendorName} — {card.name}</span>
                      </button>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <Badge variant="outline" className="text-xs">{card.currency}</Badge>
                        <Badge variant="outline" className="text-xs capitalize">{card.cardType}</Badge>
                        <span className="text-xs text-muted-foreground">{card.entryCount} rates</span>
                        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-blue-400 hover:text-blue-300"
                          onClick={() => { setImportCard(card); setImportStep('drop'); }}
                          data-testid={`button-upload-${card.id}`}>
                          <CloudUpload className="h-3 w-3" />Import
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                          onClick={() => { setPushCard(card); setPushTariffId(''); setJobId(null); setJobData(null); }}
                          data-testid={`button-push-${card.id}`}>
                          <Send className="h-3 w-3" />Push
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                          onClick={() => { setVerifyCard(card); setVerifyTariffId(''); setVerifyResult(null); }}
                          data-testid={`button-verify-${card.id}`}>
                          <ShieldCheck className="h-3 w-3" />Verify
                        </Button>
                        <a href={`/api/rate-cards/${card.id}/export`} target="_blank" rel="noreferrer">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid={`button-export-${card.id}`}>
                            <Download className="h-3 w-3" />
                          </Button>
                        </a>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300"
                          onClick={() => deleteMutation.mutate(card.id)} disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${card.id}`}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-border">
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
                          <Input
                            value={entrySearch} onChange={e => setEntrySearch(e.target.value)}
                            placeholder="Filter by prefix, country or breakout…"
                            className="h-7 text-xs max-w-xs" data-testid="input-entry-search"
                          />
                          <span className="text-xs text-muted-foreground ml-auto">{shownEntries.length} / {filteredEntries.length} shown</span>
                        </div>
                        {entriesLoading ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…
                          </div>
                        ) : (
                          <div className="overflow-x-auto max-h-64 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-background/95">
                                <tr className="text-muted-foreground border-b border-border">
                                  <th className="px-4 py-2 text-left font-medium">Prefix</th>
                                  <th className="px-4 py-2 text-left font-medium">Country</th>
                                  <th className="px-4 py-2 text-left font-medium">Breakout</th>
                                  <th className="px-4 py-2 text-right font-medium">Rate/min</th>
                                </tr>
                              </thead>
                              <tbody>
                                {shownEntries.map(e => (
                                  <tr key={e.id} className="border-b border-border/50 hover:bg-muted/30">
                                    <td className="px-4 py-1.5 font-mono">{e.prefix}</td>
                                    <td className="px-4 py-1.5 text-muted-foreground">{e.country ?? '—'}</td>
                                    <td className="px-4 py-1.5 text-muted-foreground">{e.breakout ?? '—'}</td>
                                    <td className="px-4 py-1.5 text-right font-mono">{e.ratePerMin.toFixed(4)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Push to Sippy Dialog ────────────────────────────────────────────── */}
      <Dialog open={!!pushCard} onOpenChange={o => { if (!o) { setPushCard(null); setJobId(null); setJobData(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-emerald-400" />
              {pushCard?.cardType === 'vendor' ? 'Push to Sippy Destination Set' : 'Push to Sippy Tariff'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Push all <span className="font-medium text-foreground">{pushCard?.entryCount}</span> rates from <span className="font-medium text-foreground">{pushCard?.name}</span> to a Sippy {pushCard?.cardType === 'vendor' ? 'destination set' : 'tariff'}.
            </p>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                {pushCard?.cardType === 'vendor' ? 'Target Sippy Destination Set' : 'Target Sippy Tariff'}
              </Label>
              {pushCard?.cardType === 'vendor' ? (
                // Vendor → Destination Set dropdown
                rcCtx?.destSets && rcCtx.destSets.length > 0 ? (
                  <Select value={pushTariffId} onValueChange={setPushTariffId} data-testid="select-push-destset-id">
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a destination set…" />
                    </SelectTrigger>
                    <SelectContent>
                      {rcCtx.destSets.map(ds => (
                        <SelectItem key={ds.iDestinationSet} value={String(ds.iDestinationSet)}>
                          {ds.name}
                          <span className="ml-2 text-muted-foreground text-xs">ID {ds.iDestinationSet}{ds.currency ? ` · ${ds.currency}` : ''}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-1.5">
                    <Input value={pushTariffId} onChange={e => setPushTariffId(e.target.value)} placeholder="Enter numeric destination set ID, e.g. 2" data-testid="input-push-destset-id" />
                    <p className="text-[11px] text-amber-400">Could not load destination sets from Sippy — enter the numeric ID manually.</p>
                  </div>
                )
              ) : (
                // Client → Tariff dropdown
                tariffsLoading ? (
                  <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/30 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading tariffs from Sippy…
                  </div>
                ) : sippyTariffs.length > 0 ? (
                  <Select value={pushTariffId} onValueChange={setPushTariffId} data-testid="select-push-tariff-id">
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a tariff…" />
                    </SelectTrigger>
                    <SelectContent>
                      {sippyTariffs.map(t => (
                        <SelectItem key={t.iTariff} value={String(t.iTariff)}>
                          {t.name}
                          <span className="ml-2 text-muted-foreground text-xs">ID {t.iTariff}{t.currency ? ` · ${t.currency}` : ''}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-1.5">
                    <Input value={pushTariffId} onChange={e => setPushTariffId(e.target.value)} placeholder="Enter numeric tariff ID, e.g. 42" data-testid="input-push-tariff-id" />
                    <p className="text-[11px] text-amber-400">Could not load tariffs from Sippy — enter the numeric ID manually.</p>
                  </div>
                )
              )}
              {pushTariffId && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {pushCard?.cardType === 'vendor' ? 'Destination Set ID: ' : 'Tariff ID: '}
                  <span className="font-mono text-foreground">{pushTariffId}</span>
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Effective From (optional)</Label>
              <Input type="datetime-local" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} data-testid="input-push-effective-from" />
            </div>
            {jobData && (
              <div className="space-y-2">
                <Progress value={pushProgress} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{jobData.pushed} pushed, {jobData.failed} failed</span>
                  <span className="capitalize">{jobData.status === 'done' ? <span className="text-emerald-400">Complete</span> : jobData.status === 'error' ? <span className="text-red-400">Error</span> : `${pushProgress}%`}</span>
                </div>
                {jobData.message && <p className="text-xs text-red-400">{jobData.message}</p>}
              </div>
            )}
            <Button className="w-full" onClick={startPush} disabled={!pushTariffId || (jobData?.status === 'running')} data-testid="button-confirm-push">
              {jobData?.status === 'running' ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Pushing…</> : 'Push Rates to Sippy'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Verify vs Sippy Dialog ──────────────────────────────────────────── */}
      <Dialog open={!!verifyCard} onOpenChange={o => { if (!o) { setVerifyCard(null); setVerifyResult(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-400" />
              {verifyCard?.cardType === 'vendor' ? 'Verify vs Sippy Destination Set' : 'Verify vs Sippy Tariff'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                {verifyCard?.cardType === 'vendor' ? 'Sippy Destination Set to compare against' : 'Sippy Tariff to compare against'}
              </Label>
              {verifyCard?.cardType === 'vendor' ? (
                rcCtx?.destSets && rcCtx.destSets.length > 0 ? (
                  <Select value={verifyTariffId} onValueChange={setVerifyTariffId} data-testid="select-verify-destset-id">
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a destination set…" />
                    </SelectTrigger>
                    <SelectContent>
                      {rcCtx.destSets.map(ds => (
                        <SelectItem key={ds.iDestinationSet} value={String(ds.iDestinationSet)}>
                          {ds.name}
                          <span className="ml-2 text-muted-foreground text-xs">ID {ds.iDestinationSet}{ds.currency ? ` · ${ds.currency}` : ''}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-1.5">
                    <Input value={verifyTariffId} onChange={e => setVerifyTariffId(e.target.value)} placeholder="Enter numeric destination set ID, e.g. 2" data-testid="input-verify-destset-id" />
                    <p className="text-[11px] text-amber-400">Could not load destination sets from Sippy — enter the numeric ID manually.</p>
                  </div>
                )
              ) : (
                tariffsLoading ? (
                  <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/30 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading tariffs from Sippy…
                  </div>
                ) : sippyTariffs.length > 0 ? (
                  <Select value={verifyTariffId} onValueChange={setVerifyTariffId} data-testid="select-verify-tariff-id">
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a tariff…" />
                    </SelectTrigger>
                    <SelectContent>
                      {sippyTariffs.map(t => (
                        <SelectItem key={t.iTariff} value={String(t.iTariff)}>
                          {t.name}
                          <span className="ml-2 text-muted-foreground text-xs">ID {t.iTariff}{t.currency ? ` · ${t.currency}` : ''}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-1.5">
                    <Input value={verifyTariffId} onChange={e => setVerifyTariffId(e.target.value)} placeholder="Enter numeric tariff ID, e.g. 42" data-testid="input-verify-tariff-id" />
                    <p className="text-[11px] text-amber-400">Could not load tariffs from Sippy — enter the numeric ID manually.</p>
                  </div>
                )
              )}
              {verifyTariffId && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {verifyCard?.cardType === 'vendor' ? 'Destination Set ID: ' : 'Tariff ID: '}
                  <span className="font-mono text-foreground">{verifyTariffId}</span>
                </p>
              )}
            </div>
            <Button onClick={runVerify} disabled={!verifyTariffId || verifyLoading} className="w-full" data-testid="button-run-verify">
              {verifyLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Verifying…</> : 'Run Verification'}
            </Button>
            {verifyResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Matched', value: verifyResult.matched, color: 'text-emerald-400' },
                    { label: 'Mismatched', value: verifyResult.mismatched, color: 'text-amber-400' },
                    { label: 'Local Only', value: verifyResult.localOnly, color: 'text-blue-400' },
                  ].map(s => (
                    <div key={s.label} className="bg-muted/30 rounded-lg px-3 py-2 text-center">
                      <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>
                {verifyResult.mismatchSample.length > 0 && (
                  <div className="border border-amber-500/20 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 text-xs font-medium bg-amber-500/10 text-amber-300">Rate Mismatches (sample)</div>
                    <table className="w-full text-xs">
                      <thead><tr className="text-muted-foreground border-b border-amber-500/10">
                        <th className="px-3 py-1.5 text-left">Prefix</th>
                        <th className="px-3 py-1.5 text-right">Local</th>
                        <th className="px-3 py-1.5 text-right">Sippy</th>
                      </tr></thead>
                      <tbody>
                        {verifyResult.mismatchSample.map((m, i) => (
                          <tr key={i} className="border-b border-border/50">
                            <td className="px-3 py-1.5 font-mono">{m.prefix}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{m.local.toFixed(4)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-amber-400">{m.sippy.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
