import { useState, useCallback } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ScanSearch, Globe, Smartphone, Phone, Wifi, Hash, CheckCircle2,
  AlertTriangle, Shield, Clock, ExternalLink, Loader2, RefreshCw,
  ArrowRight, Signal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

export interface NumberLookupResult {
  id?: number;
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
  rawJson: string | null;
  lookedUpAt: string;
  hlrSource?: string | null;
  networkCode?: string | null;
  cdrCount?: number | null;
  fasCount?: number | null;
}

function LineTypeIcon({ type }: { type: string | null }) {
  switch (type) {
    case "mobile":    return <Smartphone className="h-4 w-4 text-emerald-400" />;
    case "fixed":     return <Phone       className="h-4 w-4 text-blue-400" />;
    case "voip":      return <Wifi        className="h-4 w-4 text-violet-400" />;
    case "toll_free": return <Phone       className="h-4 w-4 text-amber-400" />;
    default:          return <Hash        className="h-4 w-4 text-muted-foreground" />;
  }
}

function StirChip({ level }: { level: string | null }) {
  if (!level || level === "unknown") return <span className="text-xs text-muted-foreground/50">Unknown</span>;
  const cfg: Record<string, { label: string; cls: string }> = {
    A:        { label: "A — Full",    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    B:        { label: "B — Partial", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    C:        { label: "C — Gateway", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    unsigned: { label: "Unsigned",    cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  };
  const c = cfg[level] ?? cfg.unsigned;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border", c.cls)}>
      {c.label}
    </span>
  );
}

function ReputationBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground/50">No data</span>;
  const color = score >= 70 ? "bg-rose-500" : score >= 40 ? "bg-amber-500" : "bg-emerald-500";
  const label = score >= 70 ? "High Risk" : score >= 40 ? "Medium Risk" : "Low Risk";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={score >= 70 ? "text-rose-400" : score >= 40 ? "text-amber-400" : "text-emerald-400"}>
          {label}
        </span>
        <span className="text-muted-foreground font-mono">{score}/100</span>
      </div>
      <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function DataRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-medium text-right max-w-[55%]", mono && "font-mono")}>{value}</span>
    </div>
  );
}

async function fetchLookup(number: string, force = false): Promise<NumberLookupResult> {
  const url = `/api/number-lookup/${encodeURIComponent(number)}${force ? "?refresh=1" : ""}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface Props {
  number: string;
  open: boolean;
  onClose: () => void;
}

export function NumberIntelPanel({ number, open, onClose }: Props) {
  const [, setLocation] = useLocation();
  const [result, setResult] = useState<NumberLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (num: string, force = false) => {
    if (!num) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLookup(num, force);
      setResult(data);
    } catch (e: any) {
      setError(e.message || "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, []);

  function handleOpenChange(isOpen: boolean) {
    if (isOpen && number && (!result || result.number !== number)) {
      load(number);
    }
    if (!isOpen) {
      onClose();
      setResult(null);
      setError(null);
    }
  }

  if (open && number && (!result || result.number !== number) && !loading && !error) {
    load(number);
  }

  const ageMin = result ? Math.round((Date.now() - new Date(result.lookedUpAt).getTime()) / 60000) : 0;
  const ageLabel = ageMin < 2 ? "Just looked up" : ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <ScanSearch className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="font-mono text-base leading-tight truncate">{number}</SheetTitle>
              {result?.cnam && (
                <p className="text-xs text-muted-foreground mt-0.5">{result.cnam}</p>
              )}
            </div>
            {result && (
              <div className="ml-auto flex items-center gap-1">
                <LineTypeIcon type={result.lineType} />
              </div>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading && !result && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-emerald-400/60" />
              <p className="text-sm">Looking up {number}…</p>
            </div>
          )}

          {error && (
            <div className="p-5">
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-400">
                {error}
              </div>
            </div>
          )}

          {result && (
            <div className="p-5 space-y-5">

              {/* Network block */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Network</p>
                <DataRow label="Country"
                  value={result.country
                    ? <span>{result.country}{result.countryCode ? ` (+${result.countryCode})` : ""}</span>
                    : <span className="text-muted-foreground/40">—</span>}
                />
                <DataRow label="Carrier"
                  value={result.carrier || <span className="text-muted-foreground/40">—</span>}
                />
                <DataRow label="Line Type"
                  value={result.lineType
                    ? <span className="capitalize flex items-center gap-1.5">
                        <LineTypeIcon type={result.lineType} />
                        {result.lineType.replace("_", " ")}
                      </span>
                    : <span className="text-muted-foreground/40">—</span>}
                />
                {result.networkCode && (
                  <DataRow label="Network Code" value={result.networkCode} mono />
                )}
              </div>

              {/* Status block */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Status</p>
                <DataRow label="Active (HLR)"
                  value={result.active === null
                    ? <span className="text-muted-foreground/40">Unknown</span>
                    : result.active
                      ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Active</span>
                      : <span className="flex items-center gap-1 text-rose-400"><AlertTriangle className="h-3.5 w-3.5" /> Inactive</span>}
                />
                <DataRow label="Ported"
                  value={result.ported === null
                    ? <span className="text-muted-foreground/40">Unknown</span>
                    : result.ported
                      ? <span className="text-amber-400 font-medium">Yes — ported</span>
                      : <span className="text-muted-foreground">No</span>}
                />
                <DataRow label="Roaming"
                  value={result.roaming === null
                    ? <span className="text-muted-foreground/40">Unknown</span>
                    : result.roaming
                      ? <span className="text-amber-400">Yes</span>
                      : <span className="text-muted-foreground">No</span>}
                />
              </div>

              {/* CNAM */}
              {result.cnam && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">CNAM / Subscriber</p>
                  <div className="rounded-lg bg-muted/20 border border-border px-3 py-2 text-sm font-medium">
                    {result.cnam}
                  </div>
                </div>
              )}

              {/* STIR/SHAKEN */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">STIR/SHAKEN</p>
                <StirChip level={result.stirShaken} />
                <p className="text-[10px] text-muted-foreground/50">Attestation level from most recent CDR for this number.</p>
              </div>

              {/* Reputation */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Reputation</p>
                <ReputationBar score={result.reputationScore} />
                <p className="text-[10px] text-muted-foreground/50">Based on FAS events and call pattern analysis from your CDRs.</p>
              </div>

              {/* CDR activity */}
              {(result.cdrCount !== null && result.cdrCount !== undefined) && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Activity (CDRs)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-muted/20 border border-border px-3 py-2 text-center">
                      <p className="text-lg font-bold">{result.cdrCount}</p>
                      <p className="text-[10px] text-muted-foreground">CDR records</p>
                    </div>
                    <div className="rounded-lg bg-muted/20 border border-border px-3 py-2 text-center">
                      <p className={cn("text-lg font-bold", (result.fasCount ?? 0) > 0 ? "text-rose-400" : "text-emerald-400")}>
                        {result.fasCount ?? 0}
                      </p>
                      <p className="text-[10px] text-muted-foreground">FAS flags</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Data source + freshness */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {ageLabel}</span>
                  {result.hlrSource && (
                    <span className="flex items-center gap-1">
                      <Signal className="h-3 w-3" />
                      Source: {result.hlrSource}
                    </span>
                  )}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-border px-5 py-3 flex items-center gap-2">
          <Button
            size="sm" variant="outline"
            className="flex-1"
            onClick={() => load(number, true)}
            disabled={loading}
            data-testid="button-refresh-lookup"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() => { setLocation(`/number-intelligence?number=${encodeURIComponent(number)}`); onClose(); }}
            data-testid="button-open-full-intel"
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Full Report
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface PhoneLinkProps {
  number: string | null | undefined;
  className?: string;
  mono?: boolean;
  children?: React.ReactNode;
}

export function PhoneLink({ number, className, mono = true, children }: PhoneLinkProps) {
  const [open, setOpen] = useState(false);
  if (!number) return <span className={cn("text-muted-foreground/40", className)}>—</span>;
  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        data-testid={`phone-link-${number}`}
        className={cn(
          "inline-flex items-center gap-1 group/phone hover:text-emerald-400 transition-colors cursor-pointer",
          mono && "font-mono",
          className,
        )}
        title={`Number Intelligence: ${number}`}
      >
        {children ?? number}
        <ScanSearch className="h-3 w-3 opacity-0 group-hover/phone:opacity-60 transition-opacity shrink-0" />
      </button>
      <NumberIntelPanel number={number} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
