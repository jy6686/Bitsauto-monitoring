
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Wrench, Calculator, Wifi, Zap, Star, TrendingUp, TrendingDown,
  Minus, CheckCircle2, XCircle, MinusCircle, RefreshCw, Play,
  Phone, PhoneMissed, PhoneOff, Activity, Server, Calendar,
  BarChart3, ArrowRight, Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { toUTCDateInput, toSippyDateUTC } from "@/lib/date-utils";

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

type Tab = "carrier" | "capacity" | "bandwidth" | "burst";

const TABS: { id: Tab; label: string; icon: typeof Wrench }[] = [
  { id: "carrier",   label: "Carrier Quality",    icon: Star },
  { id: "capacity",  label: "SIP Capacity",       icon: Calculator },
  { id: "bandwidth", label: "Bandwidth Planner",  icon: Wifi },
  { id: "burst",     label: "Burst Simulator",    icon: Zap },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function toLocalDateInput(d: Date) { return toUTCDateInput(d); }

function sipDate(localDt: string) {
  return toSippyDateUTC(localDt);
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
  const [startDate, setStartDate] = useState(toLocalDateInput(yesterday));
  const [endDate, setEndDate]     = useState(toLocalDateInput(now));
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);

  const { data: vsData } = useQuery<{ vendorScores: VendorFraudStats[] }>({
    queryKey: ["/api/fas/vendor-scores"],
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/fas/analyze", {
        startDate: sipDate(startDate), endDate: sipDate(endDate), limit: 500,
      }).then(r => r.json()) as Promise<AnalyzeResult>;
    },
    onSuccess: setAnalyzeResult,
  });

  function setPreset(hours: number) {
    const e = new Date(), s = new Date(e.getTime() - hours * 3600000);
    setStartDate(toLocalDateInput(s)); setEndDate(toLocalDateInput(e));
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
// Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("carrier");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wrench className="h-6 w-6 text-primary" />
          Telecom Tools &amp; Calculators
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Carrier quality scoring, SIP capacity planning, bandwidth estimation, and burst simulation
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            data-testid={`tab-${t.id}`}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.id
                ? "bg-card text-foreground shadow-sm border border-border/50"
                : "text-muted-foreground hover:text-foreground"
            }`}>
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "carrier"   && <CarrierQualityTab />}
      {activeTab === "capacity"  && <CapacityCalculatorTab />}
      {activeTab === "bandwidth" && <BandwidthPlannerTab />}
      {activeTab === "burst"     && <BurstSimulatorTab />}
    </div>
  );
}
