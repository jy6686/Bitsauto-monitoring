
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ShieldAlert, AlertTriangle, Clock, Phone, Server, RefreshCw,
  TrendingUp, Eye, Play, Calendar, Zap, Ban, PhoneOff, Activity,
  CheckCircle2, XCircle, MinusCircle, Satellite, Plus, Trash2,
  Globe, ToggleLeft, ToggleRight, ShieldBan, ScanSearch,
  Settings2, Bell, Mic, MicOff, ChevronRight, VolumeX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { toTzDateInput, toSippyDateTz, formatInTz } from "@/lib/date-utils";
import { useTimezone } from "@/context/timezone-context";

// ── Types ──────────────────────────────────────────────────────────────────

type FasEvent = {
  id: number;
  callId: string;
  caller: string | null;
  callee: string | null;
  clientName: string | null;
  vendor: string | null;
  pddSecs: number | null;
  billSecs: number | null;
  sipCode: number | null;
  reason: string | null;
  fraudScore: number | null;
  detectedAt: string;
  alertSent: boolean;
};

type VendorFraudStats = {
  vendor: string;
  totalCalls: number;
  answeredCalls: number;
  fasCount: number;
  zeroBilledCount: number;
  earlyAnswerCount: number;
  shortCallCount: number;
  highPddCount: number;
  avgPdd: number;
  avgBillSecs: number;
  fasRate: number;
  shortCallRate: number;
  zeroBilledRate: number;
  earlyAnswerRate: number;
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

type IrsfEvent = {
  id: number;
  callId: string;
  caller: string | null;
  callee: string | null;
  clientName: string | null;
  vendor: string | null;
  riskPrefix: string | null;
  country: string | null;
  breakout: string | null;
  fraudScore: number | null;
  blocked: boolean;
  detectedAt: string;
};

type BlacklistRule = {
  id: number;
  type: 'caller' | 'callee' | 'prefix';
  value: string;
  reason: string | null;
  source: string;
  active: boolean;
  hitCount: number;
  createdAt: string;
};

type FasVendorSetting = {
  vendor: string;
  suppressed: boolean;
  alertThreshold: number;
  updatedAt: string | null;
};

type RecordingStatus = {
  enabled: boolean;
  status: 'active' | 'disabled' | 'not_configured' | 'no_credentials' | 'api_error' | 'error';
  message: string;
  configKey?: string;
  configValue?: string;
};

type FasTrendDay = { date: string; count: number };

// ── Helpers ────────────────────────────────────────────────────────────────

function toLocalDateInput(d: Date, tz: string) {
  return toTzDateInput(d, tz);
}

function reasonBadges(reason: string | null) {
  if (!reason) return null;
  const parts = reason.split(",").map(s => s.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map(p => {
        if (p.startsWith("high_pdd"))
          return <Badge key={p} variant="outline" className="border-orange-500/40 text-orange-400 text-xs">High PDD</Badge>;
        if (p.startsWith("short_billed"))
          return <Badge key={p} variant="outline" className="border-red-500/40 text-red-400 text-xs">Short Billed</Badge>;
        if (p.startsWith("zero_billed"))
          return <Badge key={p} variant="outline" className="border-red-600/60 text-red-300 text-xs">Zero Billed</Badge>;
        if (p.startsWith("early_answer"))
          return <Badge key={p} variant="outline" className="border-yellow-500/40 text-yellow-400 text-xs">Early Answer</Badge>;
        if (p.startsWith("short_call"))
          return <Badge key={p} variant="outline" className="border-blue-500/40 text-blue-400 text-xs">Short Call</Badge>;
        return <Badge key={p} variant="outline" className="border-muted text-muted-foreground text-xs">{p}</Badge>;
      })}
    </div>
  );
}

function riskBadge(level: "green" | "yellow" | "red") {
  if (level === "green")
    return <Badge className="bg-green-500/20 text-green-400 border border-green-500/30 gap-1"><CheckCircle2 className="h-3 w-3" />Safe</Badge>;
  if (level === "yellow")
    return <Badge className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 gap-1"><MinusCircle className="h-3 w-3" />Suspicious</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border border-red-500/30 gap-1"><XCircle className="h-3 w-3" />High Risk</Badge>;
}

function scoreBar(score: number) {
  const color = score >= 50 ? "bg-red-500" : score >= 20 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{score}</span>
    </div>
  );
}

function pct(n: number) { return `${n.toFixed(1)}%`; }
function secs(n: number) { return `${n.toFixed(1)}s`; }

// ── Main Component ─────────────────────────────────────────────────────────

export default function FraudPage() {
  // Date range for analysis
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const { tz, tzAbbr } = useTimezone();
  const [startDate, setStartDate] = useState(() => toLocalDateInput(yesterday, tz));
  const [endDate, setEndDate]     = useState(() => toLocalDateInput(now, tz));
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);

  // FAS events from DB
  const { data: eventsData, isLoading: eventsLoading, refetch: refetchEvents, isFetching } = useQuery<{ events: FasEvent[] }>({
    queryKey: ["/api/fas-events"],
    refetchInterval: 30000,
  });

  // Vendor scores from DB events
  const { data: vsData, refetch: refetchVs } = useQuery<{ vendorScores: VendorFraudStats[] }>({
    queryKey: ["/api/fas/vendor-scores"],
    refetchInterval: 60000,
  });

  // CDR analysis mutation
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const body = {
        startDate: sipDate(startDate),
        endDate:   sipDate(endDate),
        limit: 500,
      };
      return apiRequest("POST", "/api/fas/analyze", body).then(r => r.json()) as Promise<AnalyzeResult>;
    },
    onSuccess: (data) => {
      setAnalyzeResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/fas-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fas/vendor-scores"] });
    },
  });

  function sipDate(localDt: string) {
    return toSippyDateTz(localDt, tz);
  }

  function setPreset(hours: number) {
    const e = new Date();
    const s = new Date(e.getTime() - hours * 3600000);
    setStartDate(toLocalDateInput(s, tz));
    setEndDate(toLocalDateInput(e, tz));
  }

  const events = eventsData?.events ?? [];
  const vendorScores = analyzeResult?.vendorScores ?? vsData?.vendorScores ?? [];

  // Stats
  const totalFas     = events.length;
  const alertsSent   = events.filter(e => e.alertSent).length;
  const highPdd      = events.filter(e => e.reason?.includes("high_pdd")).length;
  const shortBill    = events.filter(e => e.reason?.includes("short_billed")).length;
  const zeroBilled   = events.filter(e => e.reason?.includes("zero_billed")).length;
  const earlyAnswer  = events.filter(e => e.reason?.includes("early_answer")).length;

  const redVendors    = vendorScores.filter(v => v.riskLevel === "red").length;
  const yellowVendors = vendorScores.filter(v => v.riskLevel === "yellow").length;

  // ── IRSF Events ────────────────────────────────────────────────────────────
  const { data: irsfData, isLoading: irsfLoading, refetch: refetchIrsf } = useQuery<IrsfEvent[]>({
    queryKey: ["/api/irsf-events"],
    refetchInterval: 60000,
  });
  const irsfEvents = irsfData ?? [];
  const irsfScanMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/irsf-events/scan").then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/irsf-events"] }); },
  });

  // ── Blacklist Rules ─────────────────────────────────────────────────────────
  const { data: blacklistData, isLoading: blacklistLoading, refetch: refetchBlacklist } = useQuery<BlacklistRule[]>({
    queryKey: ["/api/blacklist-rules"],
    refetchInterval: 60000,
  });
  const blacklistRules = blacklistData ?? [];
  const [blType,   setBlType]   = useState<'caller'|'callee'|'prefix'>('callee');
  const [blValue,  setBlValue]  = useState('');
  const [blReason, setBlReason] = useState('');
  const addBlacklistMutation = useMutation({
    mutationFn: (data: { type: string; value: string; reason: string }) =>
      apiRequest("POST", "/api/blacklist-rules", data).then(r => r.json()),
    onSuccess: () => {
      setBlValue(''); setBlReason('');
      queryClient.invalidateQueries({ queryKey: ["/api/blacklist-rules"] });
    },
  });
  const deleteBlacklistMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/blacklist-rules/${id}`).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/blacklist-rules"] }),
  });
  const toggleBlacklistMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiRequest("PATCH", `/api/blacklist-rules/${id}`, { active }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/blacklist-rules"] }),
  });

  // ── Vendor Settings ────────────────────────────────────────────────────────
  const { data: vsSettingsData, refetch: refetchVsSettings } = useQuery<{ settings: FasVendorSetting[] }>({
    queryKey: ["/api/fas/vendor-settings"],
    refetchInterval: 30000,
  });
  const vendorSettings = vsSettingsData?.settings ?? [];

  const upsertVendorSettingMutation = useMutation({
    mutationFn: (data: { vendor: string; suppressed?: boolean; alertThreshold?: number }) =>
      apiRequest("POST", "/api/fas/vendor-settings", data).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/fas/vendor-settings"] }); refetchVsSettings(); },
  });
  const deleteVendorSettingMutation = useMutation({
    mutationFn: (vendor: string) => apiRequest("DELETE", `/api/fas/vendor-settings/${encodeURIComponent(vendor)}`).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/fas/vendor-settings"] }); refetchVsSettings(); },
  });

  // ── Recording Status ────────────────────────────────────────────────────────
  const { data: recordingStatus, isLoading: recordingLoading } = useQuery<RecordingStatus>({
    queryKey: ["/api/sippy/recording-status"],
    refetchInterval: 120000,
    retry: 1,
  });

  // ── Vendor Drill-Down ───────────────────────────────────────────────────────
  const [drillVendor, setDrillVendor] = useState<string | null>(null);
  const { data: drillEventsData } = useQuery<{ events: FasEvent[] }>({
    queryKey: ["/api/fas/vendor-events", drillVendor],
    enabled: !!drillVendor,
  });
  const { data: drillTrendData } = useQuery<{ trend: FasTrendDay[] }>({
    queryKey: ["/api/fas/vendor-trend", drillVendor],
    enabled: !!drillVendor,
  });
  const drillEvents = drillEventsData?.events ?? [];
  const drillTrend = drillTrendData?.trend ?? [];

  // Vendor threshold quick-add state
  const [vsVendorInput, setVsVendorInput] = useState('');
  const [vsThreshold, setVsThreshold] = useState('30');

  // Risk level helper for IRSF
  function irsfRiskBadge(score: number | null) {
    const s = score ?? 0;
    if (s >= 80) return <Badge className="bg-red-500/20 text-red-400 border border-red-500/30 text-xs">Critical</Badge>;
    if (s >= 60) return <Badge className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs">High</Badge>;
    if (s >= 40) return <Badge className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-xs">Medium</Badge>;
    return <Badge className="bg-green-500/20 text-green-400 border border-green-500/30 text-xs">Low</Badge>;
  }

  function sourceBadge(source: string) {
    const map: Record<string, string> = { manual: 'bg-blue-500/20 text-blue-400', irsf: 'bg-red-500/20 text-red-400', fas: 'bg-orange-500/20 text-orange-400', robocall: 'bg-purple-500/20 text-purple-400' };
    const cls = map[source] ?? 'bg-muted text-muted-foreground';
    return <Badge className={`${cls} border-0 text-xs`}>{source}</Badge>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-red-400" />
            Fraud &amp; FAS Detection
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            False Answer Supervision — CDR-based rule engine with vendor fraud scoring
          </p>
        </div>
        <Button
          variant="outline" size="sm"
          onClick={() => { refetchEvents(); refetchVs(); }}
          disabled={isFetching}
          data-testid="button-refresh-fraud"
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="fas" className="space-y-4">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="fas" data-testid="tab-fas" className="gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" />FAS Detection
          </TabsTrigger>
          <TabsTrigger value="irsf" data-testid="tab-irsf" className="gap-1.5">
            <Satellite className="h-3.5 w-3.5" />IRSF Detection
          </TabsTrigger>
          <TabsTrigger value="blacklist" data-testid="tab-blacklist" className="gap-1.5">
            <ShieldBan className="h-3.5 w-3.5" />Blacklist
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fas" className="mt-0 space-y-6">
          {/* CDR Analysis Runner */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Run CDR Analysis</h2>
          <span className="text-xs text-muted-foreground ml-1">— fetch Sippy CDRs and detect FAS patterns</span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1.5">
            {[
              { label: "1h", hours: 1 },
              { label: "6h", hours: 6 },
              { label: "24h", hours: 24 },
              { label: "7d", hours: 168 },
              { label: "30d", hours: 720 },
            ].map(p => (
              <Button key={p.label} variant="outline" size="sm" className="text-xs h-8"
                onClick={() => setPreset(p.hours)} data-testid={`preset-${p.label}`}>
                {p.label}
              </Button>
            ))}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1">From <span className="font-medium text-primary/60">({tzAbbr})</span></Label>
            <Input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="h-8 text-xs w-48" data-testid="input-start-date" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1">To <span className="font-medium text-primary/60">({tzAbbr})</span></Label>
            <Input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="h-8 text-xs w-48" data-testid="input-end-date" />
          </div>
          <Button
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
            data-testid="button-run-analysis"
            className="gap-2 h-8"
          >
            {analyzeMutation.isPending
              ? <RefreshCw className="h-4 w-4 animate-spin" />
              : <Play className="h-4 w-4" />}
            {analyzeMutation.isPending ? "Analyzing…" : "Run Analysis"}
          </Button>
        </div>

        {/* Analysis result banner */}
        {analyzeResult && (
          <div className={`mt-4 rounded-lg px-4 py-3 text-sm flex items-center gap-3 ${
            analyzeResult.error ? "bg-red-500/10 border border-red-500/20 text-red-400"
            : "bg-primary/10 border border-primary/20 text-primary"}`}
            data-testid="analysis-result">
            {analyzeResult.error
              ? <><XCircle className="h-4 w-4 flex-shrink-0" />{analyzeResult.error}</>
              : analyzeResult.message && analyzeResult.analyzed === 0
                ? <><MinusCircle className="h-4 w-4 flex-shrink-0" />{analyzeResult.message}</>
                : <>
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    Analyzed <strong>{analyzeResult.analyzed}</strong> CDRs — found{" "}
                    <strong>{analyzeResult.fasEvents}</strong> new FAS events across{" "}
                    <strong>{analyzeResult.vendorScores.length}</strong> clients.
                  </>
            }
          </div>
        )}
      </div>

      {/* Recording Status Banner */}
      {!recordingLoading && recordingStatus && (
        <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 text-sm ${
          recordingStatus.enabled
            ? "bg-green-500/10 border-green-500/20 text-green-400"
            : recordingStatus.status === 'not_configured'
              ? "bg-zinc-500/10 border-zinc-500/20 text-zinc-400"
              : "bg-amber-500/10 border-amber-500/20 text-amber-400"
        }`} data-testid="recording-status-banner">
          {recordingStatus.enabled
            ? <Mic className="h-4 w-4 flex-shrink-0 mt-0.5" />
            : <MicOff className="h-4 w-4 flex-shrink-0 mt-0.5" />}
          <div>
            <span className="font-semibold">Call Recording: </span>
            {recordingStatus.message}
            {recordingStatus.configKey && (
              <span className="ml-2 font-mono text-xs opacity-60">[{recordingStatus.configKey}={recordingStatus.configValue}]</span>
            )}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: "FAS Events", value: totalFas, icon: ShieldAlert, color: "text-red-400" },
          { label: "Alerts Sent", value: alertsSent, icon: AlertTriangle, color: "text-orange-400" },
          { label: "High PDD", value: highPdd, icon: Clock, color: "text-yellow-400" },
          { label: "Short Billed", value: shortBill, icon: TrendingUp, color: "text-violet-400" },
          { label: "Zero Billed", value: zeroBilled, icon: Ban, color: "text-red-300" },
          { label: "Early Answer", value: earlyAnswer, icon: Zap, color: "text-blue-400" },
        ].map(stat => (
          <div key={stat.label} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <p className={`text-2xl font-bold ${stat.color}`}
              data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* FAS Events Table */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">FAS Event Log</h2>
            <span className="ml-auto text-xs text-muted-foreground">{events.length} records</span>
          </div>
          {eventsLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <ShieldAlert className="h-10 w-10 opacity-20" />
              <p className="text-sm">No FAS events detected yet</p>
              <p className="text-xs opacity-60 text-center max-w-xs">
                Use "Run Analysis" above to pull CDRs from Sippy and detect FAS patterns automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-left">Time ({tzAbbr})</th>
                    <th className="px-4 py-3 text-left">Client</th>
                    <th className="px-4 py-3 text-left">Vendor</th>
                    <th className="px-4 py-3 text-left">Caller → Callee</th>
                    <th className="px-4 py-3 text-right">PDD</th>
                    <th className="px-4 py-3 text-right">Billed</th>
                    <th className="px-4 py-3 text-right">Score</th>
                    <th className="px-4 py-3 text-left">Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(event => (
                    <tr key={event.id}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                      data-testid={`row-fas-${event.id}`}>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatInTz(new Date(event.detectedAt), 'dd MMM yyyy HH:mm:ss', tz)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-primary/90">
                          {event.clientName || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {event.vendor ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                            <Server className="h-2.5 w-2.5" />
                            {event.vendor}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs">
                          <span className="text-muted-foreground">{event.caller ?? "—"}</span>
                          <span className="mx-1 text-muted-foreground/40">→</span>
                          <span>{event.callee ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {event.pddSecs != null ? (
                          <span className={`font-mono text-xs ${event.pddSecs > 10 ? "text-orange-400" : event.pddSecs < 2 ? "text-yellow-400" : ""}`}>
                            {event.pddSecs.toFixed(1)}s
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {event.billSecs != null ? (
                          <span className={`font-mono text-xs ${event.billSecs <= 0 ? "text-red-300" : event.billSecs < 5 ? "text-red-400" : ""}`}>
                            {event.billSecs}s
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {event.fraudScore != null ? (
                          <span className={`font-mono text-xs font-bold ${
                            event.fraudScore >= 50 ? "text-red-400" : event.fraudScore >= 20 ? "text-yellow-400" : "text-green-400"}`}>
                            {Math.round(event.fraudScore)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">{reasonBadges(event.reason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Client Risk Summary */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">Client Risk Summary</h2>
            </div>
            <div className="p-4 space-y-2">
              {vendorScores.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Run an analysis to see client scores</p>
              ) : vendorScores.slice(0, 8).map(v => (
                <div key={v.vendor} data-testid={`client-risk-${v.vendor}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono truncate max-w-[120px]">{v.vendor}</span>
                    <div className="flex items-center gap-2">
                      {riskBadge(v.riskLevel)}
                    </div>
                  </div>
                  {scoreBar(v.fraudScore)}
                </div>
              ))}
            </div>
            {(redVendors > 0 || yellowVendors > 0) && (
              <div className="px-4 pb-4">
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                  {redVendors > 0 && <p>{redVendors} high-risk client{redVendors > 1 ? "s" : ""} — review traffic immediately.</p>}
                  {yellowVendors > 0 && <p className="text-yellow-400">{yellowVendors} suspicious client{yellowVendors > 1 ? "s" : ""} — monitor closely.</p>}
                </div>
              </div>
            )}
          </div>

          {/* Detection Scenarios */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Detection Scenarios</p>
            </div>
            <div className="p-4 space-y-2.5 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <Ban className="h-3 w-3 mt-0.5 text-red-300 flex-shrink-0" />
                <div><span className="text-foreground font-medium">Zero Billed (+40)</span> — SIP 200 but 0s billed. Strongest FAS indicator.</div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="h-3 w-3 mt-0.5 text-orange-400 flex-shrink-0" />
                <div><span className="text-foreground font-medium">High PDD (+30)</span> — Slow answer; wholesaler injecting fake ringback.</div>
              </div>
              <div className="flex items-start gap-2">
                <PhoneOff className="h-3 w-3 mt-0.5 text-red-400 flex-shrink-0" />
                <div><span className="text-foreground font-medium">Short Billed (+20)</span> — Answered but billed &lt; threshold; near-instant hangup.</div>
              </div>
              <div className="flex items-start gap-2">
                <Zap className="h-3 w-3 mt-0.5 text-yellow-400 flex-shrink-0" />
                <div><span className="text-foreground font-medium">Early Answer (+15)</span> — PDD &lt; 2s; suspiciously instant answer (pre-billing).</div>
              </div>
              <div className="flex items-start gap-2">
                <Phone className="h-3 w-3 mt-0.5 text-blue-400 flex-shrink-0" />
                <div><span className="text-foreground font-medium">Short Call (+10)</span> — Brief duration; pattern indicator only.</div>
              </div>
              <p className="text-muted-foreground/50 pt-1 border-t border-border">
                Score 0–19 = Safe · 20–49 = Suspicious · 50+ = High Risk
              </p>
              <p className="text-muted-foreground/50">
                Thresholds configurable in Settings → Alert Configuration.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Vendor Fraud Scoring Table */}
      {vendorScores.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Vendor Fraud Scoring Detail</h2>
            <span className="ml-auto text-xs text-muted-foreground">{vendorScores.length} vendors</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-right">Calls</th>
                  <th className="px-4 py-3 text-right">Answered</th>
                  <th className="px-4 py-3 text-right">FAS</th>
                  <th className="px-4 py-3 text-right">FAS%</th>
                  <th className="px-4 py-3 text-right">Zero%</th>
                  <th className="px-4 py-3 text-right">Early%</th>
                  <th className="px-4 py-3 text-right">Short%</th>
                  <th className="px-4 py-3 text-right">Avg PDD</th>
                  <th className="px-4 py-3 text-right">Avg Bill</th>
                  <th className="px-4 py-3 text-right">Score</th>
                  <th className="px-4 py-3 text-center">Risk</th>
                  <th className="px-4 py-3 text-center">Drill</th>
                </tr>
              </thead>
              <tbody>
                {vendorScores.map(v => (
                  <tr key={v.vendor}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                    data-testid={`row-vendor-${v.vendor}`}>
                    <td className="px-4 py-3 font-mono text-xs font-medium">{v.vendor}</td>
                    <td className="px-4 py-3 text-right text-xs">{v.totalCalls}</td>
                    <td className="px-4 py-3 text-right text-xs">{v.answeredCalls}</td>
                    <td className="px-4 py-3 text-right text-xs text-red-400 font-medium">{v.fasCount}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs ${v.fasRate > 30 ? "text-red-400" : v.fasRate > 10 ? "text-yellow-400" : "text-muted-foreground"}`}>
                        {pct(v.fasRate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs ${v.zeroBilledRate > 20 ? "text-red-300" : "text-muted-foreground"}`}>
                        {pct(v.zeroBilledRate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs ${v.earlyAnswerRate > 20 ? "text-yellow-400" : "text-muted-foreground"}`}>
                        {pct(v.earlyAnswerRate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs ${v.shortCallRate > 30 ? "text-blue-400" : "text-muted-foreground"}`}>
                        {pct(v.shortCallRate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{secs(v.avgPdd)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{secs(v.avgBillSecs)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono text-xs font-bold ${
                        v.fraudScore >= 50 ? "text-red-400" : v.fraudScore >= 20 ? "text-yellow-400" : "text-green-400"}`}>
                        {v.fraudScore}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">{riskBadge(v.riskLevel)}</td>
                    <td className="px-4 py-3 text-center">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1 text-primary/70 hover:text-primary"
                        data-testid={`button-drill-${v.vendor}`}
                        onClick={() => setDrillVendor(v.vendor)}>
                        <ChevronRight className="h-3 w-3" />Drill
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Vendor Alert Controls ── */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <Settings2 className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Vendor Alert Controls</h2>
          <span className="text-xs text-muted-foreground ml-1">— per-vendor FAS alert thresholds &amp; suppression</span>
        </div>

        {/* Quick-add row */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1">Vendor Name</Label>
            <Input value={vsVendorInput} onChange={e => setVsVendorInput(e.target.value)}
              placeholder="e.g. Vendor-A" className="h-8 text-xs w-44" data-testid="input-vs-vendor" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1">Alert Threshold (%)</Label>
            <Input type="number" min="1" max="100" value={vsThreshold} onChange={e => setVsThreshold(e.target.value)}
              className="h-8 text-xs w-28" data-testid="input-vs-threshold" />
          </div>
          <Button size="sm" className="h-8 gap-1.5" data-testid="button-vs-add"
            disabled={!vsVendorInput.trim() || upsertVendorSettingMutation.isPending}
            onClick={() => {
              upsertVendorSettingMutation.mutate({
                vendor: vsVendorInput.trim(),
                alertThreshold: parseInt(vsThreshold) || 30,
                suppressed: false,
              });
              setVsVendorInput('');
            }}>
            <Plus className="h-3.5 w-3.5" />Add / Update
          </Button>
        </div>

        {vendorSettings.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No vendor alert rules configured yet. Add a vendor above to set custom thresholds.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Vendor</th>
                  <th className="px-4 py-2.5 text-center">Alert Threshold</th>
                  <th className="px-4 py-2.5 text-center">Suppressed</th>
                  <th className="px-4 py-2.5 text-center">Updated</th>
                  <th className="px-4 py-2.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendorSettings.map(vs => (
                  <tr key={vs.vendor} className="border-b border-border/40 hover:bg-muted/10" data-testid={`row-vs-${vs.vendor}`}>
                    <td className="px-4 py-2.5 font-mono text-xs font-medium">{vs.vendor}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-xs gap-1">
                        <Bell className="h-3 w-3" />{vs.alertThreshold}%
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-xs"
                        data-testid={`button-vs-suppress-${vs.vendor}`}
                        onClick={() => upsertVendorSettingMutation.mutate({ vendor: vs.vendor, suppressed: !vs.suppressed, alertThreshold: vs.alertThreshold })}>
                        {vs.suppressed
                          ? <><VolumeX className="h-3 w-3 text-red-400" /><span className="text-red-400">Yes</span></>
                          : <><Bell className="h-3 w-3 text-green-400" /><span className="text-green-400">No</span></>}
                      </Button>
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                      {vs.updatedAt ? formatInTz(new Date(vs.updatedAt), "dd MMM HH:mm", tz) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center flex gap-1 justify-center">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1 text-primary/70 hover:text-primary"
                        data-testid={`button-vs-drill-${vs.vendor}`}
                        onClick={() => setDrillVendor(vs.vendor)}>
                        <Eye className="h-3 w-3" />View
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-red-400 hover:text-red-300"
                        data-testid={`button-vs-delete-${vs.vendor}`}
                        onClick={() => deleteVendorSettingMutation.mutate(vs.vendor)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </TabsContent>

        {/* ── IRSF Detection Tab ── */}
        <TabsContent value="irsf" className="mt-0 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Satellite className="h-5 w-5 text-red-400" />
                IRSF Detection
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                International Revenue Share Fraud — calls to satellite, premium-rate, and high-risk destinations
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => irsfScanMutation.mutate()} disabled={irsfScanMutation.isPending} data-testid="button-irsf-scan" className="gap-1.5">
                <ScanSearch className="h-3.5 w-3.5" />{irsfScanMutation.isPending ? "Scanning..." : "Scan Now"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetchIrsf()} data-testid="button-irsf-refresh" className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />Refresh
              </Button>
            </div>
          </div>

          {/* IRSF Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Detected", value: irsfEvents.length, color: "text-red-400", icon: <Satellite className="h-4 w-4" /> },
              { label: "Satellite Calls", value: irsfEvents.filter(e => e.breakout === "Satellite").length, color: "text-orange-400", icon: <Globe className="h-4 w-4" /> },
              { label: "Africa High-Risk", value: irsfEvents.filter(e => e.breakout === "Africa").length, color: "text-yellow-400", icon: <AlertTriangle className="h-4 w-4" /> },
              { label: "Pacific Islands", value: irsfEvents.filter(e => e.breakout === "Pacific Islands").length, color: "text-purple-400", icon: <Globe className="h-4 w-4" /> },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
                <div className={`${s.color} opacity-70`}>{s.icon}</div>
                <div>
                  <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* IRSF Events Table */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Satellite className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">IRSF Events</span>
              <Badge className="bg-red-500/20 text-red-400 border-0 text-xs">{irsfEvents.length}</Badge>
            </div>
            {irsfLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
            ) : irsfEvents.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No IRSF events detected yet. Background scan runs every 5 minutes.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 text-left">When</th>
                      <th className="px-4 py-2.5 text-left">Caller</th>
                      <th className="px-4 py-2.5 text-left">Callee</th>
                      <th className="px-4 py-2.5 text-left">Client</th>
                      <th className="px-4 py-2.5 text-left">Prefix</th>
                      <th className="px-4 py-2.5 text-left">Country</th>
                      <th className="px-4 py-2.5 text-left">Breakout</th>
                      <th className="px-4 py-2.5 text-right">Risk Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {irsfEvents.slice(0, 100).map(ev => (
                      <tr key={ev.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatInTz(new Date(ev.detectedAt), 'dd MMM yyyy HH:mm:ss', tz)}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{ev.caller ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-red-400">{ev.callee ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs">{ev.clientName ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-orange-400">+{ev.riskPrefix}</td>
                        <td className="px-4 py-2.5 text-xs">{ev.country ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{ev.breakout ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right">{irsfRiskBadge(ev.fraudScore)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Blacklist Tab ── */}
        <TabsContent value="blacklist" className="mt-0 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ShieldBan className="h-5 w-5 text-red-400" />
                Blacklist Manager
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Block callers, callees, or number prefixes from generating traffic or being flagged
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchBlacklist()} data-testid="button-blacklist-refresh" className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </Button>
          </div>

          {/* Add Rule Form */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2"><Plus className="h-4 w-4 text-primary" />Add Blacklist Rule</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="w-36">
                <Label className="text-xs text-muted-foreground mb-1">Type</Label>
                <Select value={blType} onValueChange={(v) => setBlType(v as 'caller'|'callee'|'prefix')}>
                  <SelectTrigger className="h-9 text-xs" data-testid="select-bl-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caller">Caller (CLI)</SelectItem>
                    <SelectItem value="callee">Callee (CLD)</SelectItem>
                    <SelectItem value="prefix">Prefix</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-48">
                <Label className="text-xs text-muted-foreground mb-1">Number / Prefix</Label>
                <Input value={blValue} onChange={e => setBlValue(e.target.value)} placeholder={blType === 'prefix' ? 'e.g. 252 (Somalia)' : 'e.g. 12345678900'} className="h-9 text-xs" data-testid="input-bl-value" />
              </div>
              <div className="flex-1 min-w-48">
                <Label className="text-xs text-muted-foreground mb-1">Reason (optional)</Label>
                <Input value={blReason} onChange={e => setBlReason(e.target.value)} placeholder="IRSF, fraud, abuse…" className="h-9 text-xs" data-testid="input-bl-reason" />
              </div>
              <Button size="sm" onClick={() => addBlacklistMutation.mutate({ type: blType, value: blValue, reason: blReason })} disabled={!blValue || addBlacklistMutation.isPending} data-testid="button-add-blacklist" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />{addBlacklistMutation.isPending ? "Adding…" : "Add Rule"}
              </Button>
            </div>
          </div>

          {/* Blacklist Table */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <ShieldBan className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Active Rules</span>
              <Badge className="bg-muted text-muted-foreground border-0 text-xs">{blacklistRules.length}</Badge>
            </div>
            {blacklistLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
            ) : blacklistRules.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No blacklist rules yet. Add a rule above to start blocking.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 text-left">Type</th>
                      <th className="px-4 py-2.5 text-left">Value</th>
                      <th className="px-4 py-2.5 text-left">Reason</th>
                      <th className="px-4 py-2.5 text-left">Source</th>
                      <th className="px-4 py-2.5 text-right">Hits</th>
                      <th className="px-4 py-2.5 text-center">Status</th>
                      <th className="px-4 py-2.5 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blacklistRules.map(rule => (
                      <tr key={rule.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${!rule.active ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-2.5">
                          <Badge className={`text-xs border-0 ${rule.type === 'prefix' ? 'bg-purple-500/20 text-purple-400' : rule.type === 'caller' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
                            {rule.type}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-red-400">{rule.value}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-48 truncate">{rule.reason ?? "—"}</td>
                        <td className="px-4 py-2.5">{sourceBadge(rule.source)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{rule.hitCount}</td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={() => toggleBlacklistMutation.mutate({ id: rule.id, active: !rule.active })}
                            data-testid={`toggle-blacklist-${rule.id}`}
                            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${rule.active ? 'text-green-400 hover:text-red-400' : 'text-muted-foreground hover:text-green-400'}`}
                          >
                            {rule.active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                            {rule.active ? "Active" : "Disabled"}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={() => deleteBlacklistMutation.mutate(rule.id)}
                            data-testid={`delete-blacklist-${rule.id}`}
                            className="text-muted-foreground hover:text-red-400 transition-colors p-1 rounded"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Vendor Drill-Down Sheet ── */}
      <Sheet open={!!drillVendor} onOpenChange={open => { if (!open) setDrillVendor(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              FAS Drill-Down: {drillVendor}
            </SheetTitle>
          </SheetHeader>

          {/* 7-day trend bar */}
          {drillTrend.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">7-Day FAS Trend</p>
              <div className="flex items-end gap-1 h-16">
                {drillTrend.map(d => {
                  const maxCount = Math.max(...drillTrend.map(x => x.count), 1);
                  const h = Math.max(4, (d.count / maxCount) * 56);
                  return (
                    <div key={d.date} className="flex flex-col items-center gap-1 flex-1" title={`${d.date}: ${d.count}`}>
                      <div className={`w-full rounded-t transition-all ${d.count > 0 ? "bg-red-500/60" : "bg-muted/30"}`}
                        style={{ height: `${h}px` }} />
                      <span className="text-[9px] text-muted-foreground rotate-45 origin-left whitespace-nowrap">
                        {d.date.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Vendor settings inline */}
          {drillVendor && (() => {
            const vs = vendorSettings.find(v => v.vendor === drillVendor);
            return (
              <div className="mt-5 p-3 rounded-lg bg-muted/30 border border-border/50 text-sm flex items-center gap-4 flex-wrap">
                <span className="text-muted-foreground text-xs">Alert threshold:</span>
                <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-xs gap-1">
                  <Bell className="h-3 w-3" />{vs?.alertThreshold ?? 30}%
                </Badge>
                <span className="text-muted-foreground text-xs">Suppressed:</span>
                <Badge className={vs?.suppressed ? "bg-red-500/15 text-red-400 border-red-500/20 text-xs" : "bg-green-500/15 text-green-400 border-green-500/20 text-xs"}>
                  {vs?.suppressed ? "Yes" : "No"}
                </Badge>
                {!vs && (
                  <Button size="sm" variant="outline" className="h-6 text-xs gap-1 ml-auto"
                    onClick={() => upsertVendorSettingMutation.mutate({ vendor: drillVendor, alertThreshold: 30, suppressed: false })}>
                    <Bell className="h-3 w-3" />Set Alert Rule
                  </Button>
                )}
              </div>
            );
          })()}

          {/* Events list */}
          <div className="mt-5">
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
              Recent FAS Events ({drillEvents.length})
            </p>
            {drillEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No FAS events found for this vendor.</p>
            ) : (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {drillEvents.slice(0, 50).map(e => (
                  <div key={e.id} className="bg-card border border-border/60 rounded-lg px-3 py-2.5 text-xs"
                    data-testid={`drill-event-${e.id}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-muted-foreground">{formatInTz(new Date(e.detectedAt), "dd MMM HH:mm:ss", tz)}</span>
                      <span className="text-primary/60">|</span>
                      <span className="font-medium">{e.caller ?? "?"} → {e.callee ?? "?"}</span>
                      {e.fraudScore != null && (
                        <Badge className={`ml-auto text-xs ${e.fraudScore >= 50 ? "bg-red-500/20 text-red-400 border-red-500/30" : e.fraudScore >= 20 ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" : "bg-green-500/20 text-green-400 border-green-500/30"}`}>
                          Score: {e.fraudScore}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {reasonBadges(e.reason)}
                      {e.pddSecs != null && <span className="text-muted-foreground">PDD: {secs(e.pddSecs)}</span>}
                      {e.billSecs != null && <span className="text-muted-foreground">Bill: {secs(e.billSecs)}</span>}
                      {e.sipCode != null && <span className="font-mono text-muted-foreground">SIP {e.sipCode}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
