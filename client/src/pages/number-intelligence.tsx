import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScanSearch, Search, Globe, Phone, Shield, AlertTriangle, CheckCircle2, Clock, Info, Smartphone, Building, Wifi, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
}

function LineTypeIcon({ type }: { type: string | null }) {
  switch (type) {
    case 'mobile': return <Smartphone className="h-4 w-4 text-emerald-400" />;
    case 'fixed':  return <Phone className="h-4 w-4 text-blue-400" />;
    case 'voip':   return <Wifi className="h-4 w-4 text-violet-400" />;
    default:       return <Hash className="h-4 w-4 text-muted-foreground" />;
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

const RECENT_KEY = 'number-intelligence-history';

export default function NumberIntelligencePage() {
  const { toast } = useToast();
  const [inputNumber, setInputNumber] = useState('');
  const [result, setResult] = useState<NumberLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  });

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doLookup(inputNumber);
  }

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
        </div>

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
                  <div className="ml-auto text-[10px] text-muted-foreground">
                    Looked up {new Date(result.lookedUpAt).toLocaleString()}
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
                        <span className="font-medium capitalize">{result.lineType || '—'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Status</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Active</span>
                        {result.active === null ? <span className="text-muted-foreground/60">Unknown</span> : result.active ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-rose-400" />}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Ported</span>
                        {result.ported === null ? <span className="text-muted-foreground/60">Unknown</span> : result.ported ? <span className="text-amber-400 font-medium">Yes — ported</span> : <span className="text-muted-foreground">No</span>}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Roaming</span>
                        {result.roaming === null ? <span className="text-muted-foreground/60">Unknown</span> : result.roaming ? <span className="text-amber-400 font-medium">Yes</span> : <span className="text-muted-foreground">No</span>}
                      </div>
                    </div>
                  </div>

                  {/* STIR/SHAKEN */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">STIR/SHAKEN</p>
                    <StirBadge level={result.stirShaken} />
                    <p className="text-[10px] text-muted-foreground/60">Call attestation level for the most recent call from this number (from CDR data).</p>
                  </div>

                  {/* Reputation */}
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Reputation Score</p>
                    <ReputationBar score={result.reputationScore} />
                    <p className="text-[10px] text-muted-foreground/60">Based on internal CDR fraud flags and call pattern analysis.</p>
                  </div>
                </div>

                {/* Integration note */}
                <div className="px-5 pb-5">
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-muted-foreground">
                      Full HLR / CNAM data requires integration with an external provider (Telnyx, Neustar, or your own HLR gateway).
                      Data shown here is derived from your Sippy CDR records and internal analysis.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* History */}
          <div className="space-y-4">
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
          </div>
        </div>
      </div>
    </div>
  );
}
