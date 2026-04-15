
import { useState, useRef, useEffect } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CreditCard, Upload, Trash2, RefreshCw, Plus, FileText,
  ChevronDown, ChevronRight, PenLine, Download, Send,
  CheckCircle, XCircle, AlertTriangle, Loader2, ShieldCheck,
  Building2, Wallet, Database, MapPin,
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

type RateCard = {
  id: number;
  vendorName: string;
  name: string;
  cardType: string;
  currency: string;
  effectiveDate: string | null;
  entryCount: number;
  createdAt: string;
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
type SippyTariff   = { i_tariff: number; name: string; currency?: string };

type RateCardContextClient = {
  iCustomer: number;
  name: string;
  baseCurrency: string;
  iTariff: number | null;
  tariffName: string | null;
  tariffCurrency: string | null;
};
type RateCardContextDestSet = {
  iDestinationSet: number;
  name: string;
  currency: string;
};
type RateCardContextVendor = {
  iVendor: number;
  name: string;
  baseCurrency: string | null;
};
type RateCardContext = {
  clients: RateCardContextClient[];
  destSets: RateCardContextDestSet[];
  vendors: RateCardContextVendor[];
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

const CUSTOM_VENDOR = "__custom__";

// ── Main Page ──────────────────────────────────────────────────────────────
export default function RateCardsPage() {
  const { toast } = useToast();
  const search = useSearch();
  const typeParam = new URLSearchParams(search).get('type'); // 'client' | 'vendor' | null (all)
  const activeType: 'client' | 'vendor' | null =
    typeParam === 'client' ? 'client' : typeParam === 'vendor' ? 'vendor' : null;

  const [expandedCardId, setExpandedCardId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Create form
  const [selectedVendor, setSelectedVendor] = useState('');
  const [customVendor, setCustomVendor]     = useState('');
  const [newName, setNewName]               = useState('');
  const [newCurrency, setNewCurrency]       = useState('USD');
  const [newDate, setNewDate]               = useState('');

  // Upload
  const [uploadCardId, setUploadCardId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Push to Sippy
  const [pushCard, setPushCard]         = useState<RateCard | null>(null);
  const [pushTariffId, setPushTariffId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [jobId, setJobId]               = useState<string | null>(null);
  const [jobData, setJobData]           = useState<PushJob | null>(null);
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Verify
  const [verifyCard, setVerifyCard]         = useState<RateCard | null>(null);
  const [verifyTariffId, setVerifyTariffId] = useState('');
  const [verifyResult, setVerifyResult]     = useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading]   = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: cards = [], isLoading, refetch } = useQuery<RateCard[]>({
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
  const { data: sippyTariffs = [] } = useQuery<SippyTariff[]>({
    queryKey: ["/api/sippy/tariffs"],
    queryFn: () => fetch('/api/sippy/tariffs').then(r => r.json()).then(d => d.tariffs ?? d ?? []),
    refetchOnWindowFocus: false,
    enabled: !!(pushCard || verifyCard),
  });
  const { data: rcCtx, isLoading: ctxLoading } = useQuery<RateCardContext>({
    queryKey: ["/api/sippy/rate-card-context"],
    queryFn: () => fetch('/api/sippy/rate-card-context').then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/rate-cards", data).then(r => r.json()),
    onSuccess: () => {
      setCreateOpen(false);
      setSelectedVendor(''); setCustomVendor(''); setNewName(''); setNewCurrency('USD'); setNewDate('');
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

  // ── Job polling ────────────────────────────────────────────────────────────
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  const resolvedVendorName = vendorOptions.length === 0
    ? customVendor
    : selectedVendor === CUSTOM_VENDOR ? customVendor : selectedVendor;
  const canCreate = resolvedVendorName.trim() && newName.trim() && !createMutation.isPending;
  const matchedSippyClient = (activeType === 'client' && resolvedVendorName.trim())
    ? (rcCtx?.clients?.find(c => c.name.toLowerCase() === resolvedVendorName.trim().toLowerCase()) ?? null)
    : null;

  function handleSubmitCreate() {
    createMutation.mutate({
      vendorName: resolvedVendorName.trim(),
      name: newName.trim(),
      cardType: activeType ?? 'vendor',
      currency: newCurrency || 'USD',
      effectiveDate: newDate || null,
    });
  }

  // Filter cards by the active type from the URL (or show all if no type selected)
  const visibleCards = activeType ? cards.filter(c => (c.cardType ?? 'vendor') === activeType) : cards;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && uploadCardId !== null) uploadMutation.mutate({ id: uploadCardId, file });
    e.target.value = '';
  }

  async function startPush() {
    if (!pushCard || !pushTariffId) return;
    setJobData(null); setJobId(null);
    const r = await fetch(`/api/rate-cards/${pushCard.id}/push-to-sippy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tariffId: pushTariffId, effectiveFrom: effectiveFrom || undefined }),
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
      const r = await fetch(`/api/rate-cards/${verifyCard.id}/verify-sippy?tariffId=${verifyTariffId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      setVerifyResult(data);
    } catch (err: any) { toast({ title: "Verify failed", description: err.message, variant: "destructive" }); }
    setVerifyLoading(false);
  }

  const vendorOptions = clients.map(c => c.name);
  const pushProgress = jobData ? Math.round(((jobData.pushed + jobData.failed) / jobData.total) * 100) : 0;

  const typeConfig = {
    client: { label: 'Client Rate Cards', icon: Building2, iconColor: 'text-amber-400', desc: 'Rates you charge clients — upload tariff sheets to compare and push to Sippy client tariffs' },
    vendor: { label: 'Vendor Rate Cards', icon: Wallet,    iconColor: 'text-cyan-400',  desc: 'Buy-rates from your vendors — upload carrier rate sheets to compare and push to Sippy vendor tariffs' },
    all:    { label: 'Rate Cards',        icon: CreditCard, iconColor: 'text-emerald-400', desc: 'Manage client and vendor rate sheets — upload CSV or Excel to import prefix rates' },
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
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-ratecards" className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-ratecard" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />New Rate Card
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
                {/* Sippy match hint */}
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
                {activeType === 'vendor' && resolvedVendorName.trim() && rcCtx?.destSets && rcCtx.destSets.length > 0 && (
                  <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 text-cyan-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-cyan-300 font-medium">{rcCtx.destSets.length} destination set{rcCtx.destSets.length !== 1 ? 's' : ''} available in Sippy</span>
                      <div className="text-muted-foreground mt-0.5">
                        {rcCtx.destSets.slice(0, 3).map(d => d.name).join(', ')}{rcCtx.destSets.length > 3 ? ` +${rcCtx.destSets.length - 3} more` : ''}
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Rate Card Name</Label>
                  <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Q2 2026 Standard Rates" data-testid="input-card-name" />
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

      {/* Info banner */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3 items-start">
        <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-sm">
          <div className="text-amber-300 font-medium mb-0.5">Local reference store — not auto-synced to Sippy</div>
          <div className="text-muted-foreground text-xs">
            Rate Cards store rates locally for analytics and comparison. Use <span className="text-amber-300 font-medium">Push to Sippy Tariff</span> to apply them in Sippy, or <span className="text-amber-300 font-medium">Verify vs Sippy</span> to check if rates already match.
          </div>
        </div>
      </div>

      {/* Upload Format Hint */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3 items-start">
        <FileText className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm">
          <div className="text-blue-300 font-medium mb-1">CSV &amp; Excel Upload Format</div>
          <div className="text-muted-foreground text-xs font-mono">prefix, country, breakout, rate</div>
          <div className="text-muted-foreground text-xs font-mono mt-0.5">252, Somalia, Africa, 0.1250</div>
          <div className="text-muted-foreground text-xs mt-1">
            Accepts <span className="text-blue-300 font-medium">.csv</span> or <span className="text-blue-300 font-medium">.xlsx</span> — column names are auto-detected. Rate = per-minute cost in the card's currency.
          </div>
        </div>
      </div>

      {/* Sippy Reference Panel */}
      {(activeType === 'client' || activeType === null) && (rcCtx?.clients?.length ?? 0) > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-500/15">
            <Building2 className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-medium text-amber-300">Sippy Clients &amp; Assigned Tariffs</span>
            <Badge className="bg-amber-500/20 text-amber-400 border-0 text-xs ml-auto">{rcCtx?.clients?.length} clients</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-amber-500/10">
                  <th className="px-4 py-2 text-left font-medium">Client Name</th>
                  <th className="px-4 py-2 text-left font-medium">Sippy Tariff</th>
                  <th className="px-4 py-2 text-left font-medium">Tariff ID</th>
                  <th className="px-4 py-2 text-left font-medium">Currency</th>
                </tr>
              </thead>
              <tbody>
                {ctxLoading ? (
                  <tr><td colSpan={4} className="px-4 py-3 text-center text-muted-foreground text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" />Loading from Sippy…</td></tr>
                ) : (rcCtx?.clients ?? []).map(c => (
                  <tr key={c.iCustomer} className="border-b border-amber-500/5 hover:bg-amber-500/5 transition-colors" data-testid={`sippy-client-row-${c.iCustomer}`}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-foreground text-xs">{c.name}</span>
                      <span className="text-muted-foreground text-xs ml-2">#{c.iCustomer}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {c.tariffName
                        ? <span className="text-amber-300 text-xs font-medium">{c.tariffName}</span>
                        : <span className="text-muted-foreground text-xs italic">No tariff assigned</span>
                      }
                    </td>
                    <td className="px-4 py-2.5">
                      {c.iTariff
                        ? <Badge className="bg-muted text-muted-foreground border-0 text-xs font-mono">{c.iTariff}</Badge>
                        : <span className="text-muted-foreground text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.tariffCurrency || c.baseCurrency || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(activeType === 'vendor' || activeType === null) && (rcCtx?.destSets?.length ?? 0) > 0 && (
        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-cyan-500/15">
            <MapPin className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-medium text-cyan-300">Sippy Destination Sets</span>
            <Badge className="bg-cyan-500/20 text-cyan-400 border-0 text-xs ml-auto">{rcCtx?.destSets?.length} sets</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-cyan-500/10">
                  <th className="px-4 py-2 text-left font-medium">Destination Set Name</th>
                  <th className="px-4 py-2 text-left font-medium">Set ID</th>
                  <th className="px-4 py-2 text-left font-medium">Currency</th>
                </tr>
              </thead>
              <tbody>
                {ctxLoading ? (
                  <tr><td colSpan={3} className="px-4 py-3 text-center text-muted-foreground text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" />Loading from Sippy…</td></tr>
                ) : (rcCtx?.destSets ?? []).map(d => (
                  <tr key={d.iDestinationSet} className="border-b border-cyan-500/5 hover:bg-cyan-500/5 transition-colors" data-testid={`sippy-destset-row-${d.iDestinationSet}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 text-cyan-400 shrink-0" />
                        <span className="font-medium text-foreground text-xs">{d.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className="bg-muted text-muted-foreground border-0 text-xs font-mono">{d.iDestinationSet}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.currency || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(activeType === 'vendor' || activeType === null) && (rcCtx?.vendors?.length ?? 0) > 0 && (
        <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-violet-500/15">
            <Database className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-medium text-violet-300">Sippy Vendors</span>
            <Badge className="bg-violet-500/20 text-violet-400 border-0 text-xs ml-auto">{rcCtx?.vendors?.length} vendors</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-violet-500/10">
                  <th className="px-4 py-2 text-left font-medium">Vendor Name</th>
                  <th className="px-4 py-2 text-left font-medium">Vendor ID</th>
                  <th className="px-4 py-2 text-left font-medium">Currency</th>
                </tr>
              </thead>
              <tbody>
                {ctxLoading ? (
                  <tr><td colSpan={3} className="px-4 py-3 text-center text-muted-foreground text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" />Loading from Sippy…</td></tr>
                ) : (rcCtx?.vendors ?? []).map(v => (
                  <tr key={v.iVendor} className="border-b border-violet-500/5 hover:bg-violet-500/5 transition-colors" data-testid={`sippy-vendor-row-${v.iVendor}`}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-foreground text-xs">{v.name}</span>
                      <span className="text-muted-foreground text-xs ml-2">#{v.iVendor}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className="bg-muted text-muted-foreground border-0 text-xs font-mono">{v.iVendor}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{v.baseCurrency || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rate Cards List */}
      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Loading rate cards…</div>
      ) : visibleCards.length === 0 ? (
        <div className="text-center text-muted-foreground py-12 bg-card border border-border rounded-xl">
          <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <div className="font-medium mb-1">No {activeType ?? ''} rate cards yet</div>
          <div className="text-sm">Create a rate card and upload a CSV or Excel file to get started</div>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleCards.map(card => {
            const isExpanded = expandedCardId === card.id;
            return (
              <div key={card.id} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Card header row */}
                <div className="flex items-center gap-4 p-4">
                  <button onClick={() => setExpandedCardId(isExpanded ? null : card.id)} className="text-muted-foreground hover:text-foreground transition-colors" data-testid={`toggle-card-${card.id}`}>
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" data-testid={`card-name-${card.id}`}>{card.name}</span>
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-0 text-xs">{card.vendorName}</Badge>
                      {(card.cardType ?? 'vendor') === 'client'
                        ? <Badge className="bg-amber-500/20 text-amber-400 border-0 text-xs flex items-center gap-1"><Building2 className="h-2.5 w-2.5" />Client</Badge>
                        : <Badge className="bg-cyan-500/20 text-cyan-400 border-0 text-xs flex items-center gap-1"><Wallet className="h-2.5 w-2.5" />Vendor</Badge>
                      }
                      <Badge className="bg-muted text-muted-foreground border-0 text-xs">{card.currency}</Badge>
                      {card.effectiveDate && (
                        <Badge className="bg-blue-500/20 text-blue-400 border-0 text-xs">
                          Effective {new Date(card.effectiveDate).toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {card.entryCount} prefix entries · Created {new Date(card.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Export CSV */}
                    <a href={`/api/rate-cards/${card.id}/export`} download data-testid={`button-export-${card.id}`}>
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                        <Download className="h-3 w-3" />Export CSV
                      </Button>
                    </a>
                    {/* Verify vs Sippy */}
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                      onClick={() => { setVerifyCard(card); setVerifyTariffId(''); setVerifyResult(null); }}
                      data-testid={`button-verify-${card.id}`}>
                      <ShieldCheck className="h-3 w-3" />Verify vs Sippy
                    </Button>
                    {/* Push to Sippy */}
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                      onClick={() => { setPushCard(card); setPushTariffId(''); setJobId(null); setJobData(null); setEffectiveFrom(''); }}
                      data-testid={`button-push-${card.id}`}>
                      <Send className="h-3 w-3" />Push to Sippy
                    </Button>
                    {/* Upload */}
                    <Button variant="outline" size="sm"
                      onClick={() => { setUploadCardId(card.id); fileInputRef.current?.click(); }}
                      disabled={uploadMutation.isPending && uploadCardId === card.id}
                      data-testid={`button-upload-${card.id}`} className="gap-1.5 text-xs">
                      <Upload className="h-3 w-3" />
                      {uploadMutation.isPending && uploadCardId === card.id ? "Uploading…" : "Upload CSV / Excel"}
                    </Button>
                    <button onClick={() => deleteMutation.mutate(card.id)} data-testid={`button-delete-card-${card.id}`}
                      className="text-muted-foreground hover:text-red-400 transition-colors p-1.5 rounded">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded entries */}
                {isExpanded && (
                  <div className="border-t border-border">
                    {entriesLoading ? (
                      <div className="p-6 text-center text-muted-foreground text-sm">Loading entries…</div>
                    ) : entries.length === 0 ? (
                      <div className="p-6 text-center text-muted-foreground text-sm">
                        <Upload className="h-6 w-6 mx-auto mb-2 opacity-30" />
                        No entries yet. Upload a CSV or Excel file to import prefix rates.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/50">
                          Showing first 200 of {entries.length} entries
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-xs text-muted-foreground">
                              <th className="px-4 py-2 text-left">Prefix</th>
                              <th className="px-4 py-2 text-left">Country</th>
                              <th className="px-4 py-2 text-left">Breakout</th>
                              <th className="px-4 py-2 text-right">Rate/Min ({card.currency})</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.slice(0, 200).map(e => (
                              <tr key={e.id} className="border-b border-border/30 hover:bg-muted/20">
                                <td className="px-4 py-1.5 font-mono text-xs text-emerald-400">{e.prefix}</td>
                                <td className="px-4 py-1.5 text-xs">{e.country ?? "—"}</td>
                                <td className="px-4 py-1.5 text-xs text-muted-foreground">{e.breakout ?? "—"}</td>
                                <td className="px-4 py-1.5 text-right font-mono text-xs">{e.ratePerMin.toFixed(4)}</td>
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

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file"
        accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden" onChange={handleFileChange} data-testid="file-input-upload" />

      {/* ── Push to Sippy Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!pushCard} onOpenChange={open => { if (!open) { setPushCard(null); if (jobData?.status !== 'running') { setJobId(null); setJobData(null); } } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4 text-purple-400" />Push to Sippy Tariff</DialogTitle>
          </DialogHeader>
          {pushCard && (
            <div className="space-y-4 pt-1">
              <div className="bg-muted/30 rounded-lg p-3 text-sm">
                <span className="font-medium">{pushCard.name}</span>
                <span className="text-muted-foreground ml-2">{pushCard.entryCount.toLocaleString()} prefix entries</span>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Target Sippy Tariff</Label>
                <Select value={pushTariffId} onValueChange={setPushTariffId}>
                  <SelectTrigger data-testid="select-push-tariff"><SelectValue placeholder="Select tariff…" /></SelectTrigger>
                  <SelectContent>
                    {sippyTariffs.map(t => (
                      <SelectItem key={t.i_tariff} value={String(t.i_tariff)}>
                        {t.name} {t.currency ? `(${t.currency})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Effective From (optional)</Label>
                <Input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} data-testid="input-effective-from" />
              </div>

              {/* Progress */}
              {jobData && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{jobData.status === 'running' ? 'Pushing…' : jobData.status === 'done' ? 'Complete' : 'Failed'}</span>
                    <span>{jobData.pushed + jobData.failed} / {jobData.total}</span>
                  </div>
                  <Progress value={pushProgress} className="h-2" />
                  <div className="flex gap-3 text-xs">
                    <span className="text-emerald-400 flex items-center gap-1"><CheckCircle className="h-3 w-3" />{jobData.pushed} pushed</span>
                    {jobData.failed > 0 && <span className="text-red-400 flex items-center gap-1"><XCircle className="h-3 w-3" />{jobData.failed} failed</span>}
                  </div>
                  {jobData.status !== 'running' && jobData.message && (
                    <div className={`text-xs p-2 rounded ${jobData.status === 'done' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                      {jobData.message}
                    </div>
                  )}
                </div>
              )}

              {(!jobData || jobData.status !== 'running') && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300">
                  This will write rates into the selected Sippy tariff one-by-one. For large sheets (10 000+ entries) this may take several minutes.
                </div>
              )}

              <Button className="w-full gap-2" onClick={startPush}
                disabled={!pushTariffId || jobData?.status === 'running'}
                data-testid="button-start-push">
                {jobData?.status === 'running'
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Pushing {pushProgress}%…</>
                  : jobData?.status === 'done'
                  ? <><CheckCircle className="h-4 w-4" />Push again</>
                  : <><Send className="h-4 w-4" />Start Push ({pushCard.entryCount.toLocaleString()} rates)</>}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Verify vs Sippy Dialog ───────────────────────────────────────────── */}
      <Dialog open={!!verifyCard} onOpenChange={open => { if (!open) { setVerifyCard(null); setVerifyResult(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-blue-400" />Verify vs Sippy Tariff</DialogTitle>
          </DialogHeader>
          {verifyCard && (
            <div className="space-y-4 pt-1">
              <div className="bg-muted/30 rounded-lg p-3 text-sm">
                <span className="font-medium">{verifyCard.name}</span>
                <span className="text-muted-foreground ml-2">{verifyCard.entryCount.toLocaleString()} local entries</span>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Compare against Sippy Tariff</Label>
                <Select value={verifyTariffId} onValueChange={v => { setVerifyTariffId(v); setVerifyResult(null); }}>
                  <SelectTrigger data-testid="select-verify-tariff"><SelectValue placeholder="Select tariff…" /></SelectTrigger>
                  <SelectContent>
                    {sippyTariffs.map(t => (
                      <SelectItem key={t.i_tariff} value={String(t.i_tariff)}>
                        {t.name} {t.currency ? `(${t.currency})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button className="w-full gap-2" onClick={runVerify} disabled={!verifyTariffId || verifyLoading} data-testid="button-run-verify">
                {verifyLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Checking…</> : <><ShieldCheck className="h-4 w-4" />Run Verification</>}
              </Button>

              {verifyResult && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-emerald-400">{verifyResult.matched}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Matched</div>
                    </div>
                    <div className={`border rounded-lg p-3 text-center ${verifyResult.mismatched > 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-muted/20 border-border'}`}>
                      <div className={`text-2xl font-bold ${verifyResult.mismatched > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{verifyResult.mismatched}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Rate mismatch</div>
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-amber-400">{verifyResult.localOnly}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Local only (not in Sippy)</div>
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-400">{verifyResult.sippyOnly}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Sippy only (not local)</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Compared {verifyResult.localTotal.toLocaleString()} local rates against {verifyResult.sippyFetched} fetched from Sippy (max 1 000 shown).
                  </div>
                  {verifyResult.mismatchSample.length > 0 && (
                    <div>
                      <div className="text-xs font-medium mb-1 text-red-400">Rate mismatches (sample):</div>
                      <table className="w-full text-xs">
                        <thead><tr className="text-muted-foreground border-b border-border"><th className="text-left py-1">Prefix</th><th className="text-right py-1">Local</th><th className="text-right py-1">Sippy</th></tr></thead>
                        <tbody>
                          {verifyResult.mismatchSample.map(m => (
                            <tr key={m.prefix} className="border-b border-border/30">
                              <td className="py-1 font-mono text-emerald-400">{m.prefix}</td>
                              <td className="py-1 text-right font-mono">{m.local?.toFixed(4)}</td>
                              <td className="py-1 text-right font-mono text-amber-400">{m.sippy?.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
