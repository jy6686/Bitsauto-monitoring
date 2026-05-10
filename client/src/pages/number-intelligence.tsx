import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  ScanSearch, Search, Globe, Phone, Shield, AlertTriangle, CheckCircle2,
  Clock, Info, Smartphone, Building, Wifi, Hash, Settings2, Key, Zap,
  ExternalLink, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface NumberLookup {
  number: string;
  country: string | null;
  countryCode: string | null;
  carrier: string | null;
  lineType: string | null;
  ported: boolean | null;
  active: boolean | null;
  roaming: boolean | null;
  cnam: string | null;
  stirShaken: string | null;
  reputationScore: number | null;
  lookedUpAt: string;
  hlrSource?: string | null;
  networkCode?: string | null;
  cdrCount?: number | null;
  fasCount?: number | null;
}

interface HLRProviderStatus {
  hlrProvider:     string;
  hlrApiKeySet:    boolean;
  hlrApiSecretSet: boolean;
}

function LineTypeIcon({ type }: { type: string | null }) {
  switch (type) {
    case 'mobile':    return <Smartphone className="h-4 w-4 text-emerald-400" />;
    case 'fixed':     return <Phone className="h-4 w-4 text-blue-400" />;
    case 'voip':      return <Wifi className="h-4 w-4 text-violet-400" />;
    case 'toll_free': return <Phone className="h-4 w-4 text-amber-400" />;
    default:          return <Hash className="h-4 w-4 text-muted-foreground" />;
  }
}

function StirBadge({ level }: { level: string | null }) {
  if (!level) return <span className="text-muted-foreground text-xs">—</span>;
  const cfg: Record<string, { label: string; cls: string }> = {
    A:        { label: "A — Full Attestation",    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    B:        { label: "B — Partial Attestation", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    C:        { label: "C — Gateway Attestation", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    unsigned: { label: "Unsigned",                cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
    unknown:  { label: "Unknown",                 cls: "bg-muted/30 text-muted-foreground border-border" },
  };
  const c = cfg[level] ?? cfg.unknown;
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border", c.cls)}>{c.label}</span>;
}

function ReputationBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground text-xs">—</span>;
  const color = score >= 70 ? 'bg-rose-500' : score >= 40 ? 'bg-amber-500' : 'bg-emerald-500';
  const label = score >= 70 ? 'High Risk' : score >= 40 ? 'Medium Risk' : 'Low Risk';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-20">{score}/100 — {label}</span>
    </div>
  );
}

function HlrSourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  const map: Record<string, { label: string; cls: string }> = {
    telnyx:             { label: "Telnyx HLR",      cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    hlrlookup:          { label: "HLR Lookup",       cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    hlrlookup_error:    { label: "HLR Lookup error", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
    'libphonenumber+sippy_cdr': { label: "Sippy CDR", cls: "bg-muted/30 text-muted-foreground border-border" },
    sippy_cdr:          { label: "Sippy CDR",        cls: "bg-muted/30 text-muted-foreground border-border" },
    cache:              { label: "Cached",            cls: "bg-muted/30 text-muted-foreground border-border" },
    not_configured:     { label: "No HLR provider",  cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    telnyx_error:       { label: "HLR error",        cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  };
  const c = map[source] ?? { label: source, cls: "bg-muted/30 text-muted-foreground border-border" };
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", c.cls)}>{c.label}</span>;
}

const RECENT_KEY = 'number-intelligence-history';

export default function NumberIntelligencePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const qNumber = new URLSearchParams(search).get('number') ?? '';
  const [inputNumber, setInputNumber] = useState(qNumber);
  const [result, setResult] = useState<NumberLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  });

  // HLR provider config state
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [providerDraft, setProviderDraft]       = useState('none');
  const [apiKeyDraft, setApiKeyDraft]           = useState('');
  const [apiSecretDraft, setApiSecretDraft]     = useState('');
  const [savingProvider, setSavingProvider]     = useState(false);

  const { data: providerStatus } = useQuery<HLRProviderStatus>({
    queryKey: ['/api/settings/hlr-provider'],
  });

  useEffect(() => {
    if (qNumber) doLookup(qNumber);
  }, [qNumber]);

  useEffect(() => {
    if (providerStatus) {
      setProviderDraft(providerStatus.hlrProvider ?? 'none');
    }
  }, [providerStatus]);

  async function doLookup(num: string) {
    const clean = num.replace(/\s+/g, '').replace(/^00/, '+');
    if (!clean) return;
    setLoading(true);
    try {
      const res = await apiRequest('GET', `/api/number-lookup/${encodeURIComponent(clean)}`);
      const data: NumberLookup = await res.json();
      setResult(data);
      setInputNumber(clean);
      const next = [clean, ...history.filter(h => h !== clean)].slice(0, 10);
      setHistory(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch (e: any) {
      toast({ title: "Lookup failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function saveProvider() {
    setSavingProvider(true);
    try {
      await apiRequest('POST', '/api/settings/hlr-provider', {
        hlrProvider: providerDraft,
        ...(apiKeyDraft    ? { hlrApiKey:    apiKeyDraft    } : {}),
        ...(apiSecretDraft ? { hlrApiSecret: apiSecretDraft } : {}),
      });
      qc.invalidateQueries({ queryKey: ['/api/settings/hlr-provider'] });
      setApiKeyDraft('');
      setApiSecretDraft('');
      setShowProviderForm(false);
      const providerLabel = providerDraft === 'telnyx' ? 'Telnyx' : providerDraft === 'hlrlookup' ? 'HLR Lookup' : 'Disabled';
      toast({ title: "HLR provider saved", description: providerDraft === 'none' ? "Disabled" : `${providerLabel} enabled` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingProvider(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doLookup(inputNumber);
  }

  const isConfigured = providerStatus?.hlrProvider && providerStatus.hlrProvider !== 'none' && providerStatus.hlrApiKeySet;
  const needsSecret  = providerDraft === 'hlrlookup';
  const hlrlookupReady = providerDraft === 'hlrlookup' && (
    (providerStatus?.hlrApiKeySet && providerStatus?.hlrApiSecretSet) ||
    (!!apiKeyDraft && !!apiSecretDraft)
  );
  const telnyxReady  = providerDraft === 'telnyx' && (providerStatus?.hlrApiKeySet || !!apiKeyDraft);
  const canSave      = providerDraft === 'none' || hlrlookupReady || telnyxReady;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <ScanSearch className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Number Intelligence</h1>
            <p className="text-sm text-muted-foreground">HLR lookup, carrier, line type, STIR/SHAKEN, CNAM and reputation in one click</p>
          </div>
          <div className="ml-auto">
            {isConfigured ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Zap className="h-3 w-3" />
                {providerStatus?.hlrProvider === 'hlrlookup' ? 'HLR Lookup active' : 'Telnyx HLR active'}
              </span>
            ) : (
              <button
                onClick={() => setShowProviderForm(v => !v)}
                data-testid="button-configure-hlr"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
              >
                <Settings2 className="h-3 w-3" /> Configure HLR provider
              </button>
            )}
          </div>
        </div>

        {/* Provider Configuration Panel */}
        {showProviderForm && (
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">HLR / CNAM Provider</h3>
              <span className="ml-auto text-[11px] text-muted-foreground">
                Real carrier data — active status, portability, roaming, CNAM
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Provider</label>
                <Select value={providerDraft} onValueChange={v => { setProviderDraft(v); setApiKeyDraft(''); setApiSecretDraft(''); }}>
                  <SelectTrigger data-testid="select-hlr-provider" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (CDR data only)</SelectItem>
                    <SelectItem value="hlrlookup">HLR Lookup (hlrlookup.com)</SelectItem>
                    <SelectItem value="telnyx">Telnyx Number Lookup</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {providerDraft === 'telnyx' && (
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">
                    Telnyx API Key
                    {providerStatus?.hlrApiKeySet && <span className="ml-2 text-emerald-400">● key already saved</span>}
                  </label>
                  <Input
                    type="password"
                    placeholder={providerStatus?.hlrApiKeySet ? "Enter new key to replace existing…" : "KEY_…"}
                    value={apiKeyDraft}
                    onChange={e => setApiKeyDraft(e.target.value)}
                    className="h-9 text-sm font-mono"
                    data-testid="input-hlr-api-key"
                  />
                </div>
              )}

              {providerDraft === 'hlrlookup' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground font-medium">
                      API Key
                      {providerStatus?.hlrApiKeySet && providerStatus.hlrProvider === 'hlrlookup' && (
                        <span className="ml-2 text-emerald-400">● saved</span>
                      )}
                    </label>
                    <Input
                      type="password"
                      placeholder={providerStatus?.hlrApiKeySet && providerStatus.hlrProvider === 'hlrlookup' ? "Replace key…" : "Your API key"}
                      value={apiKeyDraft}
                      onChange={e => setApiKeyDraft(e.target.value)}
                      className="h-9 text-sm font-mono"
                      data-testid="input-hlr-api-key"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground font-medium">
                      API Secret
                      {providerStatus?.hlrApiSecretSet && providerStatus.hlrProvider === 'hlrlookup' && (
                        <span className="ml-2 text-emerald-400">● saved</span>
                      )}
                    </label>
                    <Input
                      type="password"
                      placeholder={providerStatus?.hlrApiSecretSet && providerStatus.hlrProvider === 'hlrlookup' ? "Replace secret…" : "Your API secret"}
                      value={apiSecretDraft}
                      onChange={e => setApiSecretDraft(e.target.value)}
                      className="h-9 text-sm font-mono"
                      data-testid="input-hlr-api-secret"
                    />
                  </div>
                </>
              )}
            </div>

            {providerDraft === 'telnyx' && (
              <p className="text-[11px] text-muted-foreground/70">
                Get your API key from{" "}
                <a href="https://portal.telnyx.com/#/app/api-keys" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                  portal.telnyx.com <ExternalLink className="h-2.5 w-2.5 inline" />
                </a>
                {" "}— Number Lookup costs ~$0.001 per lookup (no subscription).
              </p>
            )}

            {providerDraft === 'hlrlookup' && (
              <p className="text-[11px] text-muted-foreground/70">
                Get your credentials from{" "}
                <a href="https://www.hlrlookup.com/account/api" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                  hlrlookup.com/account/api <ExternalLink className="h-2.5 w-2.5 inline" />
                </a>
                {" "}— HLR lookups cover live status, carrier, line type, MCC/MNC, and porting. CNAM falls back to CDR-derived data.
                Test without credits using key <code className="bg-muted/40 px-1 rounded">speedtest</code> / secret <code className="bg-muted/40 px-1 rounded">speedtest</code>.
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={saveProvider}
                disabled={savingProvider || !canSave}
                data-testid="button-save-hlr-provider"
              >
                {savingProvider ? "Saving…" : "Save Provider"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowProviderForm(false)}>
                Cancel
              </Button>
              {isConfigured && (
                <button
                  onClick={() => setShowProviderForm(false)}
                  className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        )}

        {/* Search */}
        <form onSubmit={handleSubmit}>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={inputNumber}
                  onChange={e => setInputNumber(e.target.value)}
                  placeholder="+1 212 555 0123 or 0012125550123"
                  className="pl-10 font-mono text-sm"
                  data-testid="input-number-lookup"
                />
              </div>
              <Button type="submit" disabled={!inputNumber.trim() || loading} data-testid="button-lookup">
                {loading ? "Looking up…" : "Look Up"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Enter any E.164 or local format number. Results are cached for 24 hours.</p>
          </div>
        </form>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Result */}
          <div className="lg:col-span-2">
            {!result ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center space-y-3">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 flex items-center justify-center">
                  <ScanSearch className="h-7 w-7 text-emerald-400/50" />
                </div>
                <p className="text-sm text-muted-foreground">Enter a phone number above to run an intelligence lookup</p>
                <div className="mt-4 grid grid-cols-2 gap-3 max-w-sm mx-auto text-left">
                  {[
                    { icon: Globe, label: "Country & Carrier", desc: "Network identification" },
                    { icon: Smartphone, label: "Line Type", desc: "Mobile / fixed / VoIP" },
                    { icon: Shield, label: "STIR/SHAKEN", desc: "Call attestation level" },
                    { icon: AlertTriangle, label: "Reputation", desc: "Spam / fraud risk score" },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-2 p-2 rounded-lg bg-muted/20">
                      <item.icon className="h-3.5 w-3.5 text-muted-foreground/60 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium">{item.label}</p>
                        <p className="text-[10px] text-muted-foreground/60">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border flex items-center gap-3">
                  <LineTypeIcon type={result.lineType} />
                  <div>
                    <p className="font-mono text-lg font-bold">{result.number}</p>
                    {result.cnam && <p className="text-xs text-muted-foreground">{result.cnam}</p>}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <HlrSourceBadge source={result.hlrSource} />
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(result.lookedUpAt).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Country & Carrier */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Network</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Country</span>
                        <span className="font-medium">{result.country || '—'} {result.countryCode ? `(+${result.countryCode})` : ''}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Carrier</span>
                        <span className="font-medium">{result.carrier || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Line Type</span>
                        <span className="font-medium capitalize">{result.lineType?.replace('_', ' ') || '—'}</span>
                      </div>
                      {result.networkCode && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Network Code</span>
                          <span className="font-mono font-medium">{result.networkCode}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Status</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Active (HLR)</span>
                        {result.active === null
                          ? <span className="text-muted-foreground/60">Unknown</span>
                          : result.active
                            ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Active</span>
                            : <span className="flex items-center gap-1 text-rose-400"><AlertTriangle className="h-3.5 w-3.5" /> Inactive</span>}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Ported</span>
                        {result.ported === null
                          ? <span className="text-muted-foreground/60">Unknown</span>
                          : result.ported
                            ? <span className="text-amber-400 font-medium">Yes — ported</span>
                            : <span className="text-muted-foreground">No</span>}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Roaming</span>
                        {result.roaming === null
                          ? <span className="text-muted-foreground/60">Unknown</span>
                          : result.roaming
                            ? <span className="text-amber-400 font-medium">Yes</span>
                            : <span className="text-muted-foreground">No</span>}
                      </div>
                    </div>
                  </div>

                  {/* STIR/SHAKEN */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">STIR/SHAKEN</p>
                    <StirBadge level={result.stirShaken} />
                    <p className="text-[10px] text-muted-foreground/60">Call attestation level from most recent CDR for this number.</p>
                  </div>

                  {/* Reputation */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Reputation Score</p>
                    <ReputationBar score={result.reputationScore} />
                    <p className="text-[10px] text-muted-foreground/60">Based on internal CDR fraud flags and call pattern analysis.</p>
                  </div>
                </div>

                {/* CDR activity mini strip */}
                {(result.cdrCount !== null && result.cdrCount !== undefined) && (
                  <div className="px-5 pb-4 flex gap-3">
                    <div className="flex-1 rounded-lg bg-muted/20 border border-border px-3 py-2 text-center">
                      <p className="text-base font-bold">{result.cdrCount}</p>
                      <p className="text-[10px] text-muted-foreground">CDR records</p>
                    </div>
                    <div className="flex-1 rounded-lg bg-muted/20 border border-border px-3 py-2 text-center">
                      <p className={cn("text-base font-bold", (result.fasCount ?? 0) > 0 ? "text-rose-400" : "text-emerald-400")}>
                        {result.fasCount ?? 0}
                      </p>
                      <p className="text-[10px] text-muted-foreground">FAS flags</p>
                    </div>
                  </div>
                )}

                {/* Data source note */}
                <div className="px-5 pb-5">
                  {result.hlrSource === 'not_configured' ? (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2">
                      <Info className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                      <div className="space-y-1 flex-1">
                        <p className="text-[11px] text-muted-foreground">
                          Data shown is derived from Sippy CDR records. For live carrier, active status, portability, roaming and CNAM, configure an HLR provider.
                        </p>
                        <button
                          onClick={() => setShowProviderForm(true)}
                          className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
                        >
                          Configure HLR provider <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ) : result.hlrSource === 'telnyx_error' ? (
                    <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />
                      <p className="text-[11px] text-muted-foreground">
                        Telnyx lookup failed — showing CDR-derived data. Check your API key in the provider settings above.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border/50 bg-muted/10 p-3 flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <p className="text-[11px] text-muted-foreground">
                        Live data from <span className="text-foreground font-medium capitalize">{result.hlrSource?.replace('_', ' ')}</span>.
                        Results cached for 24 hours — click Refresh on the panel to force a new lookup.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* History */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-sm font-semibold mb-3">Recent Lookups</h3>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">No lookups yet</p>
              ) : (
                <div className="space-y-1">
                  {history.map(num => (
                    <button
                      key={num}
                      onClick={() => doLookup(num)}
                      data-testid={`history-${num}`}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors text-left"
                    >
                      <Clock className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                      {num}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick links */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold">Quick Lookup Sources</h3>
              <p className="text-[11px] text-muted-foreground">Click any number in the system to open this panel:</p>
              <ul className="text-[11px] text-muted-foreground/70 space-y-1 list-disc list-inside">
                <li>CDR Viewer → CLI / CLD columns</li>
                <li>Live Calls → Caller / Callee</li>
                <li>Fraud / FAS → flagged numbers</li>
                <li>DID Management → DID list</li>
                <li>Test Call Launcher → phone fields</li>
              </ul>
            </div>

            {/* Provider status mini-card */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                HLR Provider
              </h3>
              {providerStatus ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Provider</span>
                    <span className="text-xs font-medium capitalize">
                      {providerStatus.hlrProvider === 'none' ? 'Not configured' : providerStatus.hlrProvider}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">API Key</span>
                    <span className={cn("text-xs font-medium", providerStatus.hlrApiKeySet ? "text-emerald-400" : "text-muted-foreground/40")}>
                      {providerStatus.hlrApiKeySet ? "Saved" : "Not set"}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowProviderForm(v => !v)}
                    data-testid="button-edit-provider"
                    className="w-full mt-1 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/30 transition-colors text-center"
                  >
                    {isConfigured ? "Change provider / key" : "Configure provider"}
                  </button>
                </div>
              ) : (
                <div className="h-12 animate-pulse bg-muted/20 rounded-lg" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
