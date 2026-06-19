
import { useState, useMemo, Component } from "react";
import type { ReactNode } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Wrench, Calculator, Wifi, Zap, Star, TrendingUp, TrendingDown,
  Minus, CheckCircle2, XCircle, MinusCircle, RefreshCw, Play,
  Phone, PhoneMissed, PhoneOff, Activity, Server, Calendar,
  BarChart3, ArrowRight, Info, Route, AlertTriangle, ChevronRight,
  Loader2, DollarSign, Network, ShieldCheck, ShieldAlert, ArrowDownUp,
  Regex, ArrowRightLeft, History, Trash2, Copy, FlipHorizontal2,
  Search, Download, FileText, List,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { toTzDateInput, toSippyDateTz } from "@/lib/date-utils";
import { useTimezone } from "@/context/timezone-context";

// ── Types ──────────────────────────────────────────────────────────────────

type VendorFraudStats = {
  vendor: string;
  totalCalls: number;
  answeredCalls: number;
  fasCount: number;
  avgPdd: number;
  avgBillSecs: number;
  fasRate: number;
  fraudScore: number;
  riskLevel: "green" | "yellow" | "red";
};

type AnalyzeResult = {
  analyzed: number;
  fasEvents: number;
  vendorScores: VendorFraudStats[];
  message?: string;
  error?: string;
};

// ── Carrier Quality Score ─────────────────────────────────────────────────
// Formula (adapted from doc): 0.35(ASR%) + 0.30(ACD_norm) - 0.20(PDD_penalty) - 0.15(FraudRisk)
// ACD_norm  = min(avgBillSecs / 300, 1) * 100   — 5 min = perfect ACD
// PDD_penalty = min(avgPdd / 10, 1) * 100         — 10s+ = worst
// FraudRisk = vendor fraudScore (0-100)
function calcCarrierScore(v: VendorFraudStats): number {
  const asr        = v.answeredCalls > 0 && v.totalCalls > 0
    ? (v.answeredCalls / v.totalCalls) * 100 : 0;
  const acdNorm    = Math.min(v.avgBillSecs / 300, 1) * 100;
  const pddPenalty = Math.min(v.avgPdd / 10, 1) * 100;
  const fraud      = v.fraudScore;
  const raw = 0.35 * asr + 0.30 * acdNorm - 0.20 * pddPenalty - 0.15 * fraud;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function carrierRating(score: number): { label: string; color: string; icon: typeof CheckCircle2 } {
  if (score >= 70) return { label: "Excellent", color: "text-green-400", icon: CheckCircle2 };
  if (score >= 50) return { label: "Good",      color: "text-emerald-400", icon: CheckCircle2 };
  if (score >= 35) return { label: "Fair",      color: "text-yellow-400", icon: MinusCircle };
  if (score >= 20) return { label: "Poor",      color: "text-orange-400", icon: TrendingDown };
  return { label: "Bad", color: "text-red-400", icon: XCircle };
}

// ── Codec table ───────────────────────────────────────────────────────────
const CODECS = [
  { value: "g711",  label: "G.711 (PCMU/PCMA)", kbps: 80,  desc: "HD-quality wideband, high bandwidth" },
  { value: "g729",  label: "G.729",              kbps: 24,  desc: "Compressed, excellent for low bandwidth" },
  { value: "g722",  label: "G.722",              kbps: 80,  desc: "Wideband HD voice, same bandwidth as G.711" },
  { value: "g726",  label: "G.726 (ADPCM)",      kbps: 40,  desc: "Medium compression, legacy trunks" },
  { value: "gsm",   label: "GSM",                kbps: 13,  desc: "Very low bandwidth, lower quality" },
  { value: "opus",  label: "Opus",               kbps: 40,  desc: "Modern adaptive codec, WebRTC standard" },
] as const;

const INDUSTRIES = [
  { value: "call_center", label: "Call Center / Outbound",  concurrency: 0.55, desc: "High-volume dialer, near 1:1 agent:channel" },
  { value: "sales",       label: "Sales Team",              concurrency: 0.40, desc: "Active outbound — 40% peak concurrency" },
  { value: "law_firm",    label: "Law Firm / Legal",        concurrency: 0.15, desc: "Low concurrency — mostly inbound" },
  { value: "healthcare",  label: "Healthcare / Clinic",     concurrency: 0.25, desc: "Appointment scheduling, moderate load" },
  { value: "retail",      label: "Retail / E-Commerce",     concurrency: 0.20, desc: "Mixed inbound/outbound, seasonal spikes" },
  { value: "government",  label: "Government / Public",     concurrency: 0.20, desc: "Steady inbound volume" },
  { value: "education",   label: "Education",               concurrency: 0.15, desc: "Low baseline, peaks during enrollment" },
  { value: "general",     label: "General Business",        concurrency: 0.25, desc: "Average office usage across all functions" },
] as const;

// ── Tabs ───────────────────────────────────────────────────────────────────

type Tab = "carrier" | "capacity" | "bandwidth" | "burst" | "route" | "translation" | "coverage";

const TABS: { id: Tab; label: string; icon: typeof Wrench }[] = [
  { id: "carrier",     label: "Carrier Quality",          icon: Star },
  { id: "capacity",    label: "SIP Capacity",             icon: Calculator },
  { id: "bandwidth",   label: "Bandwidth Planner",        icon: Wifi },
  { id: "burst",       label: "Burst Simulator",          icon: Zap },
  { id: "route",       label: "Route Tester",             icon: Route },
  { id: "translation", label: "Translation Tester",       icon: ArrowRightLeft },
  { id: "coverage",    label: "Prefix Coverage Checker",  icon: Search },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function toLocalDateInput(d: Date, tz: string) { return toTzDateInput(d, tz); }

function sipDate(localDt: string, tz: string) {
  return toSippyDateTz(localDt, tz);
}

function kbpsToMbps(kbps: number) { return (kbps / 1000).toFixed(2); }

// ── Stat pill ─────────────────────────────────────────────────────────────
function StatPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg px-4 py-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold font-mono mt-0.5">{value}</p>
      {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1 — Carrier Quality Dashboard
// ═══════════════════════════════════════════════════════════════════════════
function CarrierQualityTab() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const { tz } = useTimezone();
  const [startDate, setStartDate] = useState(() => toLocalDateInput(yesterday, tz));
  const [endDate, setEndDate]     = useState(() => toLocalDateInput(now, tz));
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);

  const { data: vsData } = useQuery<{ vendorScores: VendorFraudStats[] }>({
    queryKey: ["/api/fas/vendor-scores"],
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/fas/analyze", {
        startDate: sipDate(startDate, tz), endDate: sipDate(endDate, tz), limit: 500,
      }).then(r => r.json()) as Promise<AnalyzeResult>;
    },
    onSuccess: setAnalyzeResult,
  });

  function setPreset(hours: number) {
    const e = new Date(), s = new Date(e.getTime() - hours * 3600000);
    setStartDate(toLocalDateInput(s, tz)); setEndDate(toLocalDateInput(e, tz));
  }

  const rawScores = analyzeResult?.vendorScores ?? vsData?.vendorScores ?? [];
  const scores = useMemo(() => rawScores.map(v => ({
    ...v, carrierScore: calcCarrierScore(v),
  })).sort((a, b) => b.carrierScore - a.carrierScore), [rawScores]);

  return (
    <div className="space-y-5">
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Load CDR Data</h3>
          <span className="text-xs text-muted-foreground">— analyze vendor/carrier quality from Sippy CDRs</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1.5">
            {[{ l: "24h", h: 24 }, { l: "7d", h: 168 }, { l: "30d", h: 720 }].map(p => (
              <Button key={p.l} variant="outline" size="sm" className="text-xs h-8"
                onClick={() => setPreset(p.h)} data-testid={`carrier-preset-${p.l}`}>{p.l}</Button>
            ))}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1">From</Label>
            <Input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="h-8 text-xs w-48" data-testid="carrier-from" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1">To</Label>
            <Input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="h-8 text-xs w-48" data-testid="carrier-to" />
          </div>
          <Button onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}
            className="gap-2 h-8" data-testid="button-carrier-analyze">
            {analyzeMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {analyzeMutation.isPending ? "Analyzing…" : "Analyze"}
          </Button>
        </div>
        {analyzeResult && (
          <p className="mt-3 text-xs text-muted-foreground">
            {analyzeResult.error ?? analyzeResult.message ?? `${analyzeResult.analyzed} CDRs analyzed — ${analyzeResult.vendorScores.length} carriers scored.`}
          </p>
        )}
      </div>

      {/* Score formula */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 mb-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Carrier Score Formula</p>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono text-foreground">Score = 0.35 × ASR% + 0.30 × ACD_norm − 0.20 × PDD_penalty − 0.15 × FraudRisk</span>
          <br />
          <span className="opacity-60">where ACD_norm = min(avgBilled/300, 1)×100 · PDD_penalty = min(avgPDD/10, 1)×100 · FraudRisk = FAS score 0–100</span>
        </p>
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
          {[
            { label: "Excellent", range: "70–100", color: "text-green-400" },
            { label: "Good",      range: "50–69",  color: "text-emerald-400" },
            { label: "Fair",      range: "35–49",  color: "text-yellow-400" },
            { label: "Poor",      range: "20–34",  color: "text-orange-400" },
            { label: "Bad",       range: "0–19",   color: "text-red-400" },
          ].map(r => (
            <span key={r.label} className={`font-semibold ${r.color}`}>{r.label} ({r.range})</span>
          ))}
        </div>
      </div>

      {scores.length === 0 ? (
        <div className="bg-card rounded-xl border border-border flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Server className="h-10 w-10 opacity-20" />
          <p className="text-sm">No carrier data yet</p>
          <p className="text-xs opacity-60">Run an analysis above to score your carriers from Sippy CDRs.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Star className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Carrier Rankings</h3>
            <span className="ml-auto text-xs text-muted-foreground">{scores.length} carriers</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left w-6">#</th>
                  <th className="px-4 py-3 text-left">Carrier / Vendor</th>
                  <th className="px-4 py-3 text-right">Calls</th>
                  <th className="px-4 py-3 text-right">ASR%</th>
                  <th className="px-4 py-3 text-right">Avg ACD</th>
                  <th className="px-4 py-3 text-right">Avg PDD</th>
                  <th className="px-4 py-3 text-right">FAS%</th>
                  <th className="px-4 py-3 text-right">Score</th>
                  <th className="px-4 py-3 text-center">Rating</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((v, i) => {
                  const rating = carrierRating(v.carrierScore);
                  const asr = v.totalCalls > 0 ? (v.answeredCalls / v.totalCalls * 100).toFixed(1) : "0.0";
                  return (
                    <tr key={v.vendor}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                      data-testid={`carrier-row-${v.vendor}`}>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{i + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs font-medium">{v.vendor}</td>
                      <td className="px-4 py-3 text-right text-xs">{v.totalCalls}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-mono ${Number(asr) >= 70 ? "text-green-400" : Number(asr) >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                          {asr}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{v.avgBillSecs.toFixed(0)}s</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{v.avgPdd.toFixed(1)}s</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs ${v.fasRate > 20 ? "text-red-400" : "text-muted-foreground"}`}>
                          {v.fasRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${v.carrierScore >= 70 ? "bg-green-500" : v.carrierScore >= 50 ? "bg-emerald-500" : v.carrierScore >= 35 ? "bg-yellow-500" : v.carrierScore >= 20 ? "bg-orange-500" : "bg-red-500"}`}
                              style={{ width: `${v.carrierScore}%` }} />
                          </div>
                          <span className={`font-mono text-xs font-bold ${rating.color}`}>{v.carrierScore}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-medium ${rating.color}`}>{rating.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Callback Ratio Reference */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Phone className="h-4 w-4 text-violet-400" />
          <h3 className="font-semibold text-sm">Call Back Ratio — Reference</h3>
          <Badge variant="outline" className="text-violet-400 border-violet-500/30 text-xs">FAS Deduction</Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The <strong className="text-foreground">Callback Ratio</strong> (also called Connection Rate) measures how many calls
          actually reached the intended person vs total attempts. Failed dispositions (wrong number SIP 404,
          switched off SIP 480, untraceable SIP 484/488) are deducted.
        </p>
        <div className="mt-3 p-3 bg-muted/30 rounded-lg font-mono text-xs text-center">
          Callback Ratio = Connected ÷ (Total − Busy) × 100
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3 text-xs text-center">
          <div className="bg-green-500/10 rounded-lg p-2.5 border border-green-500/20">
            <p className="text-green-400 font-bold text-sm">≥ 80%</p>
            <p className="text-muted-foreground mt-0.5">Excellent</p>
          </div>
          <div className="bg-yellow-500/10 rounded-lg p-2.5 border border-yellow-500/20">
            <p className="text-yellow-400 font-bold text-sm">60–79%</p>
            <p className="text-muted-foreground mt-0.5">Acceptable</p>
          </div>
          <div className="bg-red-500/10 rounded-lg p-2.5 border border-red-500/20">
            <p className="text-red-400 font-bold text-sm">&lt; 60%</p>
            <p className="text-muted-foreground mt-0.5">Poor — investigate route</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/60 mt-2">
          Live Callback Ratio is shown on the Dashboard under the KPI cards.
          Alert rules: if ASR &lt; 60% → poor route quality · if ACD &lt; 30s → possible FAS.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2 — SIP Channel Capacity Calculator
// ═══════════════════════════════════════════════════════════════════════════
function CapacityCalculatorTab() {
  const [employees, setEmployees] = useState(100);
  const [concurrency, setConcurrency] = useState(25);
  const [codec, setCodec]       = useState("g711");
  const [industry, setIndustry] = useState("general");
  const [safetyMargin, setSafetyMargin] = useState(20);

  const selectedCodec = CODECS.find(c => c.value === codec) ?? CODECS[0];
  const selectedIndustry = INDUSTRIES.find(i => i.value === industry) ?? INDUSTRIES[7];

  const concurrencyRate = concurrency / 100;
  const baseConcurrentCalls = Math.ceil(employees * concurrencyRate);
  const industryConcurrentCalls = Math.ceil(employees * selectedIndustry.concurrency);
  const finalChannels = Math.ceil(baseConcurrentCalls * (1 + safetyMargin / 100));
  const industryFinalChannels = Math.ceil(industryConcurrentCalls * (1 + safetyMargin / 100));
  const bandwidthKbps = finalChannels * selectedCodec.kbps;
  const industryBandwidthKbps = industryFinalChannels * selectedCodec.kbps;

  function useIndustryRate() {
    setConcurrency(Math.round(selectedIndustry.concurrency * 100));
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Inputs */}
      <div className="space-y-4">
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" /> Input Parameters
          </h3>

          <div className="space-y-1.5">
            <Label className="text-xs">Number of Employees / Agents</Label>
            <Input type="number" min={1} value={employees}
              onChange={e => setEmployees(Number(e.target.value))}
              data-testid="input-employees" className="h-8 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Peak Concurrency % (manual)</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={100} value={concurrency}
                onChange={e => setConcurrency(Number(e.target.value))}
                data-testid="input-concurrency" className="h-8 text-sm w-24" />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Industry / Business Type</Label>
            <Select value={industry} onValueChange={setIndustry}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-industry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map(i => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label} ({Math.round(i.concurrency * 100)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{selectedIndustry.desc}</p>
            <Button variant="outline" size="sm" className="text-xs h-7 mt-1"
              onClick={useIndustryRate} data-testid="button-use-industry-rate">
              Use industry rate ({Math.round(selectedIndustry.concurrency * 100)}%)
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Codec</Label>
            <Select value={codec} onValueChange={setCodec}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-codec">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODECS.map(c => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label} ({c.kbps} Kbps/call)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{selectedCodec.desc}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Safety Margin %</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} max={100} value={safetyMargin}
                onChange={e => setSafetyMargin(Number(e.target.value))}
                data-testid="input-safety-margin" className="h-8 text-sm w-24" />
              <span className="text-xs text-muted-foreground">% overhead for peak overflow</span>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="space-y-4">
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" /> Your Configuration Results
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <StatPill label="Concurrent Calls" value={String(baseConcurrentCalls)} sub={`at ${concurrency}% peak`} />
            <StatPill label="SIP Channels Needed" value={String(finalChannels)} sub={`incl. ${safetyMargin}% margin`} />
            <StatPill label="Voice Bandwidth" value={`${kbpsToMbps(bandwidthKbps)} Mbps`} sub={`${bandwidthKbps} Kbps total`} />
            <StatPill label="Per-Call Bandwidth" value={`${selectedCodec.kbps} Kbps`} sub={selectedCodec.label} />
          </div>
          <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 text-xs">
            <p className="font-semibold text-primary mb-1">Recommendation</p>
            <p className="text-muted-foreground">
              Provision <strong className="text-foreground">{finalChannels} SIP channels</strong> for{" "}
              {employees} employees at {concurrency}% peak using {selectedCodec.label}.
              Ensure at least <strong className="text-foreground">{kbpsToMbps(Math.ceil(bandwidthKbps * 1.2))} Mbps</strong>{" "}
              dedicated voice bandwidth (including 20% QoS overhead).
            </p>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" /> Industry Benchmark Comparison
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <StatPill label="Industry Concurrent" value={String(industryConcurrentCalls)} sub={`at ${Math.round(selectedIndustry.concurrency * 100)}%`} />
            <StatPill label="Industry Channels" value={String(industryFinalChannels)} sub="recommended" />
            <StatPill label="Industry Bandwidth" value={`${kbpsToMbps(industryBandwidthKbps)} Mbps`} sub="voice only" />
            <StatPill label="Δ vs Manual" value={`${finalChannels > industryFinalChannels ? "+" : ""}${finalChannels - industryFinalChannels}`} sub="channels" />
          </div>
          <p className="text-xs text-muted-foreground">
            Industry standard for <strong className="text-foreground">{selectedIndustry.label}</strong>:{" "}
            {Math.round(selectedIndustry.concurrency * 100)}% concurrency. Your manual setting: {concurrency}%.
          </p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — Bandwidth Planner
// ═══════════════════════════════════════════════════════════════════════════
function BandwidthPlannerTab() {
  const [concurrent, setConcurrent] = useState(20);
  const [availableMbps, setAvailableMbps] = useState(50);
  const [vpnOverhead, setVpnOverhead]   = useState(false);
  const [qosOverhead, setQosOverhead]   = useState(true);

  const overheadMultiplier = 1 + (qosOverhead ? 0.10 : 0) + (vpnOverhead ? 0.15 : 0);

  const rows = CODECS.map(c => {
    const rawKbps = concurrent * c.kbps;
    const totalKbps = Math.ceil(rawKbps * overheadMultiplier);
    const totalMbps = totalKbps / 1000;
    const utilizationPct = (totalMbps / availableMbps) * 100;
    const safe = utilizationPct <= 60;
    const ok   = utilizationPct <= 80;
    return { ...c, rawKbps, totalKbps, totalMbps, utilizationPct, safe, ok };
  });

  const maxConcurrentByCodec = CODECS.map(c => ({
    label: c.label,
    maxCalls: Math.floor((availableMbps * 1000 * 0.7) / (c.kbps * overheadMultiplier)),
  }));

  return (
    <div className="space-y-5">
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
          <Wifi className="h-4 w-4 text-primary" /> Configuration
        </h3>
        <div className="flex flex-wrap gap-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Concurrent Calls</Label>
            <Input type="number" min={1} value={concurrent}
              onChange={e => setConcurrent(Number(e.target.value))}
              data-testid="input-concurrent" className="h-8 w-28" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Available Internet (Mbps)</Label>
            <Input type="number" min={1} value={availableMbps}
              onChange={e => setAvailableMbps(Number(e.target.value))}
              data-testid="input-available-mbps" className="h-8 w-28" />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Overhead</Label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={qosOverhead} onChange={e => setQosOverhead(e.target.checked)}
                data-testid="checkbox-qos" className="rounded" />
              QoS overhead (+10%)
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={vpnOverhead} onChange={e => setVpnOverhead(e.target.checked)}
                data-testid="checkbox-vpn" className="rounded" />
              VPN tunnel overhead (+15%)
            </label>
          </div>
        </div>
      </div>

      {/* Codec comparison table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Bandwidth by Codec — {concurrent} concurrent calls</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left">Codec</th>
                <th className="px-4 py-3 text-right">Per Call</th>
                <th className="px-4 py-3 text-right">Raw Total</th>
                <th className="px-4 py-3 text-right">With Overhead</th>
                <th className="px-4 py-3 text-right">Utilization</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.value} className="border-b border-border/50" data-testid={`bw-row-${r.value}`}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-xs font-medium">{r.label}</p>
                      <p className="text-xs text-muted-foreground/60">{r.desc}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{r.kbps} Kbps</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{r.rawKbps} Kbps</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-medium">{kbpsToMbps(r.totalKbps)} Mbps</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${r.safe ? "bg-green-500" : r.ok ? "bg-yellow-500" : "bg-red-500"}`}
                          style={{ width: `${Math.min(r.utilizationPct, 100)}%` }} />
                      </div>
                      <span className={`font-mono text-xs ${r.safe ? "text-green-400" : r.ok ? "text-yellow-400" : "text-red-400"}`}>
                        {r.utilizationPct.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.safe
                      ? <Badge className="bg-green-500/15 text-green-400 border-green-500/25 text-xs">Safe</Badge>
                      : r.ok
                        ? <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/25 text-xs">Caution</Badge>
                        : <Badge className="bg-red-500/15 text-red-400 border-red-500/25 text-xs">Over Capacity</Badge>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Max calls by codec */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-semibold text-sm mb-3">Max Concurrent Calls @ {availableMbps} Mbps (70% safe utilization)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {maxConcurrentByCodec.map(c => (
            <StatPill key={c.label} label={c.label} value={`${c.maxCalls} calls`} sub="max concurrent" />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Recommendation: Keep voice traffic below 70% of available bandwidth to maintain QoS headroom.
          Dedicated voice VLAN + QoS marking (DSCP EF = 46) strongly recommended.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4 — Burst Capacity Simulator
// ═══════════════════════════════════════════════════════════════════════════
function BurstSimulatorTab() {
  const [normalChannels, setNormalChannels] = useState(50);
  const [peakMultiplier, setPeakMultiplier] = useState(2.0);
  const [overflowPct, setOverflowPct]       = useState(20);
  const [codec, setCodec]                   = useState("g729");

  const burstChannels     = Math.ceil(normalChannels * peakMultiplier);
  const overflowChannels  = Math.ceil(burstChannels * (overflowPct / 100));
  const totalChannels     = burstChannels + overflowChannels;
  const selectedCodec     = CODECS.find(c => c.value === codec) ?? CODECS[1];
  const normalBwMbps      = (normalChannels * selectedCodec.kbps) / 1000;
  const burstBwMbps       = (burstChannels * selectedCodec.kbps) / 1000;
  const totalBwMbps       = (totalChannels * selectedCodec.kbps) / 1000;

  const SCENARIOS = [
    { label: "Sales Campaign",      multiplier: 2.5, overflow: 25, desc: "Heavy outbound dialing campaign" },
    { label: "Customer Support Spike", multiplier: 1.8, overflow: 15, desc: "Inbound volume surge" },
    { label: "Ramadan/Eid (Pakistan)", multiplier: 3.0, overflow: 30, desc: "Holiday season traffic peak" },
    { label: "Election Hotline",    multiplier: 4.0, overflow: 40, desc: "Extreme inbound spike event" },
    { label: "Healthcare Appts",    multiplier: 1.5, overflow: 10, desc: "Appointment scheduling peak" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Inputs */}
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Simulator Inputs
          </h3>

          <div className="space-y-1.5">
            <Label className="text-xs">Normal Channels (baseline)</Label>
            <Input type="number" min={1} value={normalChannels}
              onChange={e => setNormalChannels(Number(e.target.value))}
              data-testid="input-normal-channels" className="h-8" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Peak Multiplier</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} step={0.1} value={peakMultiplier}
                onChange={e => setPeakMultiplier(Number(e.target.value))}
                data-testid="input-peak-multiplier" className="h-8 w-24" />
              <span className="text-xs text-muted-foreground">× normal</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Overflow Buffer %</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} max={100} value={overflowPct}
                onChange={e => setOverflowPct(Number(e.target.value))}
                data-testid="input-overflow-pct" className="h-8 w-24" />
              <span className="text-xs text-muted-foreground">% extra above burst</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Codec</Label>
            <Select value={codec} onValueChange={setCodec}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-burst-codec">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODECS.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Results */}
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" /> Capacity Plan
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <StatPill label="Normal Channels" value={String(normalChannels)} sub="baseline" />
            <StatPill label="Burst Channels" value={String(burstChannels)} sub={`× ${peakMultiplier}`} />
            <StatPill label="+ Overflow Buffer" value={`+${overflowChannels}`} sub={`${overflowPct}% of burst`} />
            <StatPill label="Total Provisioned" value={String(totalChannels)} sub="peak + overflow" />
          </div>

          <div className="space-y-2">
            <h4 className="text-xs text-muted-foreground uppercase tracking-wide">Bandwidth</h4>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-muted/20 rounded p-2">
                <p className="text-xs text-muted-foreground">Normal</p>
                <p className="font-mono font-bold">{normalBwMbps.toFixed(2)} Mbps</p>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-2">
                <p className="text-xs text-yellow-400">Burst</p>
                <p className="font-mono font-bold">{burstBwMbps.toFixed(2)} Mbps</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded p-2">
                <p className="text-xs text-red-400">Peak Total</p>
                <p className="font-mono font-bold">{totalBwMbps.toFixed(2)} Mbps</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 text-xs">
            <p className="font-semibold text-primary mb-1">Summary</p>
            <p className="text-muted-foreground">
              Provision <strong className="text-foreground">{totalChannels} SIP channels</strong> for{" "}
              burst peaks ({normalChannels} normal × {peakMultiplier} + {overflowPct}% overflow).
              Ensure <strong className="text-foreground">{(totalBwMbps * 1.2).toFixed(2)} Mbps</strong> bandwidth during peak.
            </p>
          </div>
        </div>
      </div>

      {/* Preset Scenarios */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-semibold text-sm mb-3">Quick Scenario Presets</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SCENARIOS.map(s => (
            <button
              key={s.label}
              onClick={() => { setPeakMultiplier(s.multiplier); setOverflowPct(s.overflow); }}
              className="text-left bg-muted/20 hover:bg-muted/40 transition-colors rounded-lg p-3 border border-border/50"
              data-testid={`burst-preset-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className="text-sm font-medium">{s.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
              <div className="flex gap-3 mt-2 text-xs">
                <span className="text-primary font-mono">{s.multiplier}× peak</span>
                <span className="text-muted-foreground">+{s.overflow}% overflow</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 5 — Dialplan / Route Tester
// ═══════════════════════════════════════════════════════════════════════════

interface DialplanRoute {
  iRoute: number | null;
  iVendor: number | null;
  vendorName: string | null;
  iConnection: number | null;
  connectionName: string | null;
  prefix: string | null;
  capacity: number | null;
  numSessions: number | null;
  preference: number | null;
  estimatedCost: string | null;
  price1: string | null;
  priceN: string | null;
  connectFee: string | null;
  connectionQuality: string | null;
  qualityMonitorEnabled: boolean | null;
  forbidden: boolean | null;
  huntstop: boolean | null;
  areaName: string | null;
  error: string | null;
}

interface DialplanResult {
  result: string | null;
  cause: string | null;
  iAccount: number | null;
  iCustomer: number | null;
  tariffName: string | null;
  prefix: string | null;
  cli: string | null;
  cld: string | null;
  username: string | null;
  price1: string | null;
  priceN: string | null;
  connectFee: string | null;
  estimatedCostOrig: string | null;
  routingGroupName: string | null;
  lrnCld: string | null;
  lrnCli: string | null;
  areaName: string | null;
  routes: DialplanRoute[] | null;
}

function QualityDot({ q }: { q: string | null }) {
  const color =
    q === "good"    ? "bg-emerald-500" :
    q === "average" ? "bg-amber-500"   :
    q === "bad"     ? "bg-rose-500"    : "bg-muted";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={q ?? "unknown"} />;
}

function RouteTestTab() {
  const [cli, setCli]                     = useState("");
  const [cld, setCld]                     = useState("");
  const [remoteIp, setRemoteIp]           = useState("");
  const [toDomain, setToDomain]           = useState("");
  const [fallbackAccount, setFallbackAccount] = useState("");

  const { data: acctData } = useQuery<{ success: boolean; accounts: Array<{ iAccount: number; username: string }> }>({
    queryKey: ["/api/sippy/accounts"],
  });
  const accounts = acctData?.accounts ?? [];

  const testMut = useMutation<{ success: boolean; data?: DialplanResult; error?: string }, Error, void>({
    mutationFn: () =>
      apiRequest("POST", "/api/sippy/test-dialplan", {
        cli:               cli.trim(),
        cld:               cld.trim(),
        remoteIp:          remoteIp.trim() || undefined,
        toDomain:          toDomain.trim() || undefined,
        fallbackIAccount:  fallbackAccount || undefined,
      }).then(r => r.json()),
  });

  const result = testMut.data?.data;

  const resultColor =
    !testMut.isSuccess           ? "text-muted-foreground" :
    result?.result === "allowed" ? "text-emerald-400"       :
    result?.result === "blocked" ? "text-rose-400"           : "text-amber-400";

  return (
    <div className="space-y-6">
      {/* Input form */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Route className="w-4 h-4 text-blue-400" />
          <h3 className="font-semibold text-sm">Test a Call Route</h3>
          <span className="text-xs text-muted-foreground">— simulates how Sippy will route a call</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rt-cli">CLI (Caller ID) *</Label>
            <Input
              id="rt-cli"
              data-testid="input-route-cli"
              placeholder="e.g. 14155551234"
              value={cli}
              onChange={e => setCli(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-cld">CLD (Destination Number) *</Label>
            <Input
              id="rt-cld"
              data-testid="input-route-cld"
              placeholder="e.g. 12125551234"
              value={cld}
              onChange={e => setCld(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-ip">Remote IP (caller source IP) *</Label>
            <Input
              id="rt-ip"
              data-testid="input-route-ip"
              placeholder="e.g. 192.168.1.1"
              value={remoteIp}
              onChange={e => setRemoteIp(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Required by Sippy for auth rule matching</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-domain">To Domain (optional)</Label>
            <Input
              id="rt-domain"
              data-testid="input-route-domain"
              placeholder="e.g. sip.example.com"
              value={toDomain}
              onChange={e => setToDomain(e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Fallback Account (if CLI not auto-authenticated)</Label>
            <Select value={fallbackAccount || "__auto__"} onValueChange={v => setFallbackAccount(v === "__auto__" ? "" : v)}>
              <SelectTrigger data-testid="select-fallback-account">
                <SelectValue placeholder="— Auto-detect from auth rules —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">— Auto-detect from auth rules —</SelectItem>
                {accounts.map(a => (
                  <SelectItem key={a.iAccount} value={String(a.iAccount)}>{a.username} (#{a.iAccount})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Select an account if Sippy can't match the CLI to an auth rule</p>
          </div>
        </div>

        <Button
          data-testid="button-test-route"
          onClick={() => testMut.mutate()}
          disabled={testMut.isPending || !cli.trim() || !cld.trim() || !remoteIp.trim()}
          className="w-full sm:w-auto"
        >
          {testMut.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Testing…</>
            : <><Play className="w-4 h-4 mr-2" /> Run Route Test</>}
        </Button>
      </div>

      {/* Error from API */}
      {testMut.isError && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-rose-500/25 bg-rose-500/8 text-rose-300 text-sm">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          {testMut.error?.message ?? "Request failed"}
        </div>
      )}

      {/* Result */}
      {testMut.isSuccess && result && (
        <div className="space-y-4">
          {/* Auth / origination summary */}
          <div className="rounded-xl border border-border/50 bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                Authorization &amp; Origination
              </h3>
              <span className={`text-sm font-bold uppercase tracking-wide ${resultColor}`}>
                {result.result ?? "—"}
              </span>
            </div>
            {result.cause && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {result.cause}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {[
                { label: "Account",       value: result.username ?? (result.iAccount ? `#${result.iAccount}` : null) },
                { label: "Tariff",        value: result.tariffName },
                { label: "Routing Group", value: result.routingGroupName },
                { label: "Area",          value: result.areaName },
                { label: "CLI (out)",     value: result.cli },
                { label: "CLD (out)",     value: result.cld },
                { label: "LRN CLD",       value: result.lrnCld },
                { label: "Connect Fee",   value: result.connectFee ? `$${result.connectFee}` : null },
                { label: "Rate /min",     value: result.price1 ? `$${result.price1}` : null },
                { label: "Est. Cost",     value: result.estimatedCostOrig ? `$${result.estimatedCostOrig}` : null },
              ].filter(r => r.value).map(r => (
                <div key={r.label} className="bg-muted/30 rounded-lg px-3 py-2">
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide">{r.label}</p>
                  <p className="font-mono font-semibold text-foreground mt-0.5 truncate">{r.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Routes list */}
          {result.routes && result.routes.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Network className="w-4 h-4 text-violet-400" />
                  Routing Order
                </h3>
                <span className="text-xs text-muted-foreground">{result.routes.length} route{result.routes.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30 bg-muted/20">
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">#</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Vendor / Connection</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Prefix</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Area</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Rate</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Est. Cost</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Capacity</th>
                      <th className="text-center px-4 py-2.5 text-muted-foreground font-medium">Quality</th>
                      <th className="text-center px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.routes.map((r, i) => (
                      <tr
                        key={i}
                        data-testid={`route-row-${i}`}
                        className={`border-b border-border/20 ${r.forbidden ? "opacity-40" : ""} ${i % 2 === 0 ? "" : "bg-muted/5"}`}
                      >
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted/40 text-muted-foreground font-mono text-[10px]">{i + 1}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-foreground">{r.vendorName ?? `Vendor#${r.iVendor}`}</div>
                          {r.connectionName && <div className="text-muted-foreground text-[10px]">{r.connectionName}</div>}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-blue-400">{r.prefix ?? "—"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.areaName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          {r.price1 ? <span className="text-emerald-400">${r.price1}</span> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          {r.estimatedCost ? <span className="text-amber-400">${r.estimatedCost}</span> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {r.capacity != null && r.numSessions != null
                            ? <span className={r.numSessions >= r.capacity ? "text-rose-400" : "text-muted-foreground"}>{r.numSessions}/{r.capacity}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <QualityDot q={r.connectionQuality} />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {r.forbidden ? (
                            <span className="text-rose-400 font-semibold">Blocked</span>
                          ) : r.huntstop ? (
                            <span className="text-amber-400">Huntstop</span>
                          ) : r.error ? (
                            <span className="text-rose-400 text-[10px]" title={r.error}>Error</span>
                          ) : (
                            <span className="text-emerald-400">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.routes.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No routes returned — call would fail to route.
                </div>
              )}
            </div>
          )}

          {/* No routes */}
          {(!result?.routes || result.routes.length === 0) && testMut.isSuccess && (
            <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-500/25 bg-amber-500/8 text-amber-300 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              No routing entries returned. Call would fail. Check the CLI/CLD or account setup.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Translation Tester Tab
// ═══════════════════════════════════════════════════════════════════════════

type TranslationMode = "translate" | "match";

type HistoryEntry = {
  id: number;
  mode: TranslationMode;
  rule: string;
  number: string;
  result: string;
  success: boolean;
  ts: Date;
};

const TRANSLATION_PRESETS = [
  { label: "Strip leading 00",         rule: "s/^00/+/" },
  { label: "Add +1 to 10-digit US",    rule: "s/^([2-9][0-9]{9})$/+1\\1/" },
  { label: "E.164 from 0-prefix (UK)", rule: "s/^0([0-9]{10})$/+44\\1/" },
  { label: "Strip +",                  rule: "s/^\\+/00/" },
  { label: "Add country code +7 (RU)", rule: "s/^8([0-9]{10})$/+7\\1/" },
  { label: "Remove all spaces",        rule: "s/ //g" },
];

const MATCH_PRESETS = [
  { label: "Any E.164",          rule: "^\\+[1-9][0-9]{6,14}$" },
  { label: "US/Canada +1",       rule: "^\\+1[2-9][0-9]{9}$" },
  { label: "UK +44",             rule: "^\\+44[0-9]{10}$" },
  { label: "10-digit US (bare)", rule: "^[2-9][0-9]{9}$" },
  { label: "Starts with 00",     rule: "^00[0-9]+" },
  { label: "Any numeric",        rule: "^[0-9]+$" },
];

let _histId = 0;

function TranslationTesterTab() {
  const [mode, setMode]       = useState<TranslationMode>("translate");
  const [rule, setRule]       = useState("");
  const [number, setNumber]   = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const translateMut = useMutation({
    mutationFn: (body: { rule: string; number: string }) =>
      apiRequest("POST", "/api/sippy/apply-translation-rule", body).then(r => r.json()),
  });

  const matchMut = useMutation({
    mutationFn: (body: { rule: string; number: string }) =>
      apiRequest("POST", "/api/sippy/check-match-rule", body).then(r => r.json()),
  });

  const isPending = translateMut.isPending || matchMut.isPending;

  const lastTranslate = translateMut.data as { success: boolean; number?: string; error?: string } | undefined;
  const lastMatch     = matchMut.data    as { success: boolean; match?: boolean;  error?: string } | undefined;
  const lastResult    = mode === "translate" ? lastTranslate : lastMatch;

  function handleTest() {
    if (!rule.trim() || !number.trim()) return;
    const body = { rule: rule.trim(), number: number.trim() };

    if (mode === "translate") {
      translateMut.mutate(body, {
        onSettled: (data: any) => {
          const resultStr = data?.success
            ? `→ ${data.number ?? "(empty)"}`
            : `Error: ${data?.error ?? "Unknown error"}`;
          setHistory(h => [{ id: ++_histId, mode, rule: body.rule, number: body.number, result: resultStr, success: !!data?.success, ts: new Date() }, ...h].slice(0, 50));
        },
      });
    } else {
      matchMut.mutate(body, {
        onSettled: (data: any) => {
          const resultStr = data?.success
            ? (data.match ? "MATCH" : "NO MATCH")
            : `Error: ${data?.error ?? "Unknown error"}`;
          setHistory(h => [{ id: ++_histId, mode, rule: body.rule, number: body.number, result: resultStr, success: !!data?.success, ts: new Date() }, ...h].slice(0, 50));
        },
      });
    }
  }

  const presets = mode === "translate" ? TRANSLATION_PRESETS : MATCH_PRESETS;

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 w-fit">
        <button
          data-testid="translation-mode-translate"
          onClick={() => { setMode("translate"); translateMut.reset(); matchMut.reset(); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "translate"
              ? "bg-card text-foreground shadow-sm border border-border/50"
              : "text-muted-foreground hover:text-foreground"
          }`}>
          <ArrowRightLeft className="h-4 w-4" />
          Translation Rule
        </button>
        <button
          data-testid="translation-mode-match"
          onClick={() => { setMode("match"); translateMut.reset(); matchMut.reset(); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "match"
              ? "bg-card text-foreground shadow-sm border border-border/50"
              : "text-muted-foreground hover:text-foreground"
          }`}>
          <Regex className="h-4 w-4" />
          Match Rule
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input panel */}
        <div className="bg-card rounded-xl border border-border/50 p-5 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            {mode === "translate" ? <ArrowRightLeft className="h-4 w-4 text-primary" /> : <Regex className="h-4 w-4 text-primary" />}
            {mode === "translate" ? "Apply Translation Rule" : "Check Match Rule"}
          </h3>

          {/* Rule input */}
          <div className="space-y-1.5">
            <Label htmlFor="trans-rule" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {mode === "translate" ? "Translation Rule (sed-style)" : "Match Rule (regex)"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="trans-rule"
                data-testid="input-translation-rule"
                value={rule}
                onChange={e => setRule(e.target.value)}
                placeholder={mode === "translate" ? "s/^00/+/" : "^\\+1[0-9]{10}$"}
                className="font-mono text-sm"
              />
              {rule && (
                <button
                  data-testid="btn-copy-rule"
                  onClick={() => navigator.clipboard.writeText(rule)}
                  className="p-2 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy rule">
                  <Copy className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Number input */}
          <div className="space-y-1.5">
            <Label htmlFor="trans-number" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Phone Number
            </Label>
            <Input
              id="trans-number"
              data-testid="input-translation-number"
              value={number}
              onChange={e => setNumber(e.target.value)}
              placeholder="+12125551234"
              className="font-mono text-sm"
              onKeyDown={e => e.key === "Enter" && handleTest()}
            />
          </div>

          <Button
            data-testid="btn-translation-test"
            onClick={handleTest}
            disabled={isPending || !rule.trim() || !number.trim()}
            className="w-full">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
            {isPending ? "Testing…" : "Test Rule"}
          </Button>

          {/* Result display */}
          {lastResult && (
            <div className={`rounded-lg p-4 border ${
              lastResult.success
                ? mode === "match"
                  ? (lastMatch?.match ? "border-green-500/30 bg-green-500/10" : "border-amber-500/30 bg-amber-500/10")
                  : "border-green-500/30 bg-green-500/10"
                : "border-rose-500/30 bg-rose-500/10"
            }`}>
              {mode === "translate" && lastTranslate?.success && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Input</p>
                  <p className="font-mono text-sm text-muted-foreground">{number}</p>
                  <div className="flex items-center gap-2 my-1">
                    <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">Output</p>
                  <p className="font-mono text-lg font-bold text-green-400">{lastTranslate.number || "(empty string)"}</p>
                </div>
              )}
              {mode === "match" && lastMatch?.success && (
                <div className="flex items-center gap-3">
                  {lastMatch.match
                    ? <CheckCircle2 className="h-6 w-6 text-green-400 shrink-0" />
                    : <XCircle className="h-6 w-6 text-amber-400 shrink-0" />}
                  <div>
                    <p className={`font-bold text-lg ${lastMatch.match ? "text-green-400" : "text-amber-400"}`}>
                      {lastMatch.match ? "MATCH" : "NO MATCH"}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{number}</p>
                  </div>
                </div>
              )}
              {!lastResult.success && (
                <div className="flex items-start gap-2 text-rose-400">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Rule error</p>
                    <p className="text-xs mt-0.5 font-mono">{(lastResult as any).error}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Presets panel */}
        <div className="bg-card rounded-xl border border-border/50 p-5 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FlipHorizontal2 className="h-4 w-4 text-primary" />
            Common {mode === "translate" ? "Translation" : "Match"} Patterns
          </h3>
          <p className="text-xs text-muted-foreground">Click a preset to load it into the rule field.</p>
          <div className="space-y-2">
            {presets.map(p => (
              <button
                key={p.rule}
                data-testid={`preset-${p.label.replace(/\s+/g, "-").toLowerCase()}`}
                onClick={() => setRule(p.rule)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors hover:bg-muted/40 ${
                  rule === p.rule ? "border-primary/50 bg-primary/5" : "border-border/40"
                }`}>
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">{p.rule}</p>
              </button>
            ))}
          </div>
          {mode === "translate" && (
            <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground space-y-1 border border-border/30">
              <p className="font-semibold text-foreground/70">Translation rule syntax</p>
              <p><span className="font-mono text-primary">s/pattern/replacement/flags</span></p>
              <p>Use <span className="font-mono">g</span> flag for global replace, <span className="font-mono">i</span> for case-insensitive.</p>
              <p>Capture groups: <span className="font-mono">\1 \2</span> etc.</p>
            </div>
          )}
          {mode === "match" && (
            <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground space-y-1 border border-border/30">
              <p className="font-semibold text-foreground/70">Match rule syntax</p>
              <p>Standard POSIX/PCRE regular expression.</p>
              <p>Anchors <span className="font-mono">^ $</span> are recommended for exact matches.</p>
              <p>Escape special chars: <span className="font-mono">\. \+ \(</span> etc.</p>
            </div>
          )}
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="bg-card rounded-xl border border-border/50 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Session History
              <Badge variant="secondary" className="text-xs">{history.length}</Badge>
            </h3>
            <button
              data-testid="btn-clear-history"
              onClick={() => setHistory([])}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-rose-400 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th className="text-left py-1.5 pr-3 font-medium">Mode</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Number</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Rule</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Result</th>
                  <th className="text-left py-1.5 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-1.5 pr-3">
                      <Badge variant="outline" className={`text-xs ${h.mode === "translate" ? "border-blue-500/40 text-blue-400" : "border-purple-500/40 text-purple-400"}`}>
                        {h.mode === "translate" ? "Trans" : "Match"}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-muted-foreground">{h.number}</td>
                    <td className="py-1.5 pr-3 font-mono max-w-[180px] truncate text-muted-foreground" title={h.rule}>{h.rule}</td>
                    <td className={`py-1.5 pr-3 font-mono font-semibold ${
                      !h.success ? "text-rose-400"
                      : h.result === "MATCH" ? "text-green-400"
                      : h.result === "NO MATCH" ? "text-amber-400"
                      : "text-green-400"
                    }`}>{h.result}</td>
                    <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                      {h.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Boundary — catches any render crash and shows a helpful message
// instead of a blank page
// ═══════════════════════════════════════════════════════════════════════════
class ToolsErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-rose-400">
            <XCircle className="h-5 w-5" />
            <h2 className="font-semibold">Tools page crashed</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            A JavaScript error occurred while rendering this page. Details below:
          </p>
          <pre className="bg-muted/30 rounded-lg p-4 text-xs font-mono text-rose-300 whitespace-pre-wrap break-all overflow-auto max-h-64">
            {this.state.error.toString()}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            className="text-sm text-primary underline"
            onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 7 — Prefix Coverage Checker (Bulk)
// ═══════════════════════════════════════════════════════════════════════════

const MAX_BULK = 50;

type BulkRow = {
  cld:       string;
  status:    'pending' | 'running' | 'done' | 'error';
  result?:   string | null;
  tariff?:   string | null;
  routeCount?: number;
  bestRoute?: string | null;
  cost?:     string | null;
  error?:    string;
};

function PrefixCoverageTab() {
  const [rawInput, setRawInput]             = useState("");
  const [accountId, setAccountId]           = useState<string>("");
  const [rows, setRows]                     = useState<BulkRow[]>([]);
  const [running, setRunning]               = useState(false);
  const [progress, setProgress]             = useState(0);

  const { data: acctData } = useQuery<{ success: boolean; accounts: Array<{ iAccount: number; username: string }> }>({
    queryKey: ["/api/sippy/accounts"],
  });
  const accounts = acctData?.accounts ?? [];

  const parsedCLDs = rawInput
    .split(/[\n,;]+/)
    .map(s => s.trim().replace(/\s+/g, ''))
    .filter(s => s.length > 0)
    .slice(0, MAX_BULK);

  async function runAll() {
    if (parsedCLDs.length === 0) return;
    const initial: BulkRow[] = parsedCLDs.map(cld => ({ cld, status: 'pending' }));
    setRows(initial);
    setRunning(true);
    setProgress(0);

    for (let i = 0; i < parsedCLDs.length; i++) {
      const cld = parsedCLDs[i];
      setRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'running' } : r));
      try {
        const res = await fetch('/api/sippy/test-dialplan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cli: '10000000000',
            cld: cld.replace(/^\+/, ''),
            fallbackIAccount: accountId || undefined,
          }),
        });
        const data = await res.json();
        const d: DialplanResult | undefined = data?.data;
        const routes = d?.routes ?? [];
        const best = routes.find(r => !r.forbidden && !r.huntstop) ?? routes[0];
        setRows(prev => prev.map((r, idx) =>
          idx === i ? {
            ...r,
            status: 'done',
            result:     d?.result ?? (data?.error ? 'error' : 'unknown'),
            tariff:     d?.tariffName ?? null,
            routeCount: routes.length,
            bestRoute:  best?.connectionName ?? best?.vendorName ?? null,
            cost:       best?.estimatedCost ?? best?.price1 ?? null,
          } : r
        ));
      } catch (e: any) {
        setRows(prev => prev.map((r, idx) =>
          idx === i ? { ...r, status: 'error', error: e.message } : r
        ));
      }
      setProgress(i + 1);
    }
    setRunning(false);
  }

  function exportCsv() {
    const header = 'CLD,Result,Tariff,Routes,Best Connection,Cost\n';
    const body = rows.map(r =>
      [r.cld, r.result ?? '', r.tariff ?? '', r.routeCount ?? '', r.bestRoute ?? '', r.cost ?? ''].map(v => `"${v}"`).join(',')
    ).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'prefix_coverage.csv' });
    a.click();
    URL.revokeObjectURL(url);
  }

  const doneCount    = rows.filter(r => r.status === 'done').length;
  const allowedCount = rows.filter(r => r.result === 'allowed').length;
  const blockedCount = rows.filter(r => r.result === 'blocked').length;
  const errorCount   = rows.filter(r => r.status === 'error').length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-sm text-violet-300">
        <Search className="h-4 w-4 mt-0.5 shrink-0 text-violet-400" />
        <span>
          Bulk-test up to <strong>{MAX_BULK}</strong> destination numbers against Sippy's live dialplan.
          Each CLD is tested independently and the allowed/blocked status, tariff, route count, and best connection are shown.
        </span>
      </div>

      {/* Input form */}
      <div className="rounded-xl border border-border/50 bg-card/60 p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2"><List className="h-4 w-4 text-violet-400" />Destination Numbers</h3>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">
            CLDs to test <span className="text-muted-foreground/60">(one per line, comma or semicolon separated)</span>
          </label>
          <textarea
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            rows={6}
            placeholder={"447911123456\n14155551234\n33123456789\n+49301234567"}
            value={rawInput}
            onChange={e => setRawInput(e.target.value)}
            data-testid="textarea-bulk-clds"
          />
          <p className="text-xs text-muted-foreground">
            {parsedCLDs.length} number{parsedCLDs.length !== 1 ? 's' : ''} detected
            {parsedCLDs.length >= MAX_BULK && <span className="text-amber-400"> — capped at {MAX_BULK}</span>}
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Account (optional — uses default routing if omitted)</label>
          <select
            className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            data-testid="select-bulk-account"
          >
            <option value="">— Default (no account) —</option>
            {accounts.map(a => (
              <option key={a.iAccount} value={a.iAccount}>{a.username} (#{a.iAccount})</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={runAll}
            disabled={running || parsedCLDs.length === 0}
            data-testid="button-run-coverage"
          >
            {running
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Running {progress}/{parsedCLDs.length}…</>
              : <><Search className="h-4 w-4 mr-2" />Run Coverage Check</>
            }
          </Button>
          {rows.length > 0 && !running && (
            <Button variant="outline" onClick={exportCsv} data-testid="button-export-coverage">
              <Download className="h-4 w-4 mr-2" />Export CSV
            </Button>
          )}
        </div>

        {/* Progress bar */}
        {running && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{progress} / {parsedCLDs.length}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-300"
                style={{ width: `${parsedCLDs.length ? (progress / parsedCLDs.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Summary row */}
      {rows.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-xl border border-border/40 bg-muted/10 px-3 py-2.5 text-center">
            <p className="text-xl font-bold">{rows.length}</p><p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5 text-center">
            <p className="text-xl font-bold text-emerald-400">{allowedCount}</p><p className="text-xs text-muted-foreground">Allowed</p>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/8 px-3 py-2.5 text-center">
            <p className="text-xl font-bold text-rose-400">{blockedCount}</p><p className="text-xs text-muted-foreground">Blocked</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2.5 text-center">
            <p className="text-xl font-bold text-amber-400">{errorCount}</p><p className="text-xs text-muted-foreground">Errors</p>
          </div>
        </div>
      )}

      {/* Results table */}
      {rows.length > 0 && (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/20 border-b border-border/40">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Results</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="bg-muted/20 border-b border-border/30">
                <tr className="text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">#</th>
                  <th className="px-4 py-2.5 text-left font-medium">CLD</th>
                  <th className="px-4 py-2.5 text-left font-medium">Result</th>
                  <th className="px-4 py-2.5 text-left font-medium">Tariff</th>
                  <th className="px-4 py-2.5 text-center font-medium">Routes</th>
                  <th className="px-4 py-2.5 text-left font-medium">Best Connection</th>
                  <th className="px-4 py-2.5 text-right font-medium">Est. Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-muted/20 transition-colors" data-testid={`coverage-row-${i}`}>
                    <td className="px-4 py-2 font-mono text-muted-foreground/60">{i + 1}</td>
                    <td className="px-4 py-2 font-mono font-medium">{r.cld}</td>
                    <td className="px-4 py-2">
                      {r.status === 'pending' && <span className="text-muted-foreground/40">—</span>}
                      {r.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />}
                      {r.status === 'error'   && <span className="text-rose-400">Error</span>}
                      {r.status === 'done'    && (
                        r.result === 'allowed' ? (
                          <span className="flex items-center gap-1 text-emerald-400 font-medium"><CheckCircle2 className="h-3.5 w-3.5" />Allowed</span>
                        ) : r.result === 'blocked' ? (
                          <span className="flex items-center gap-1 text-rose-400 font-medium"><XCircle className="h-3.5 w-3.5" />Blocked</span>
                        ) : (
                          <span className="text-amber-400">{r.result}</span>
                        )
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{r.tariff ?? (r.status === 'done' ? '—' : '')}</td>
                    <td className="px-4 py-2 text-center font-mono">{r.routeCount !== undefined ? r.routeCount : ''}</td>
                    <td className="px-4 py-2 text-violet-400 font-medium">{r.bestRoute ?? (r.status === 'done' ? '—' : '')}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.cost ?? (r.status === 'done' ? '—' : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════

function ToolsPageInner() {
  const search   = useSearch();
  const activeTab = ((new URLSearchParams(search)).get("tab") ?? "carrier") as Tab;

  const activeTabMeta = TABS.find(t => t.id === activeTab) ?? TABS[0];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wrench className="h-6 w-6 text-primary" />
          Telecom Tools &amp; Calculators
        </h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
          <activeTabMeta.icon className="h-3.5 w-3.5 text-muted-foreground" />
          {activeTabMeta.label}
        </p>
      </div>

      {/* Tab content — navigation is via sidebar dropdown */}
      {activeTab === "carrier"     && <CarrierQualityTab />}
      {activeTab === "capacity"    && <CapacityCalculatorTab />}
      {activeTab === "bandwidth"   && <BandwidthPlannerTab />}
      {activeTab === "burst"       && <BurstSimulatorTab />}
      {activeTab === "route"       && <RouteTestTab />}
      {activeTab === "translation" && <TranslationTesterTab />}
      {activeTab === "coverage"    && <PrefixCoverageTab />}
    </div>
  );
}

export default function ToolsPage() {
  return (
    <ToolsErrorBoundary>
      <ToolsPageInner />
    </ToolsErrorBoundary>
  );
}
