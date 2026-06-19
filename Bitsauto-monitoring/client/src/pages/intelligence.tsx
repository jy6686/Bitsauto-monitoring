import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  GitBranch,
  Activity,
  Clock,
  Layers,
  Zap,
  TrendingDown,
  TrendingUp,
  Minus,
  RefreshCw,
  Info,
  Link2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ── Types ────────────────────────────────────────────────────────────────────

interface LedgerEvent {
  ledger_id: string;
  scope: string;
  source_system: string;
  action_type: string;
  entity_id: string | null;
  entity_name: string | null;
  event_type: string;
  approval_state: string;
  execution_state: string;
  created_at: string;
  actor_name: string | null;
  note: string | null;
  intent_id: string | null;
  intent_label: string | null;
}

interface IntentGroup {
  intentId: string;
  intentLabel: string | null;
  events: LedgerEvent[];
  systems: string[];
  eventCount: number;
  firstAt: string;
  lastAt: string;
}

interface Incident {
  id: number;
  entityType: string;
  entityId: string;
  entityName: string | null;
  incidentType: string;
  severity: string;
  confidence: number;
  title: string;
  summary: string | null;
  status: string;
  source: string;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  correlatedLedgerEvents: LedgerEvent[];
}

interface CarrierScore {
  carrierId: string | number;
  carrierName: string;
  stabilityScore: number;
  rollingAsr: number;
  avgPddMs: number;
  failureRate: number;
  sampleCount: number;
  trend?: string;
}

interface TimelineItem {
  ts: string;
  type: "ledger" | "incident";
  label: string;
  severity?: string;
  system?: string;
}

interface ChainData {
  windowMinutes: number;
  fromIso: string;
  intentGroups: IntentGroup[];
  noIntentEvents: LedgerEvent[];
  incidents: Incident[];
  carrierScores: CarrierScore[];
  timeline: TimelineItem[];
  totals: {
    ledgerEvents: number;
    incidents: number;
    intentGroups: number;
    carriers: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [
  { label: "30 min", value: 30 },
  { label: "1 hr", value: 60 },
  { label: "4 hr", value: 240 },
  { label: "24 hr", value: 1440 },
];

function severityColor(sev: string) {
  if (sev === "critical") return "text-red-400 bg-red-900/30 border-red-800";
  if (sev === "high")     return "text-orange-400 bg-orange-900/30 border-orange-800";
  if (sev === "medium")   return "text-yellow-400 bg-yellow-900/30 border-yellow-800";
  return "text-blue-400 bg-blue-900/30 border-blue-800";
}

function eventTypeColor(et: string) {
  if (et === "executed" || et === "approved") return "text-emerald-400";
  if (et === "rejected" || et === "execution_failed") return "text-red-400";
  if (et === "submitted" || et === "created") return "text-blue-400";
  if (et === "rolled_back") return "text-orange-400";
  return "text-slate-400";
}

function systemBadgeColor(sys: string) {
  if (sys === "C2")      return "bg-violet-900/40 text-violet-300 border-violet-700";
  if (sys === "ROUTING") return "bg-cyan-900/40 text-cyan-300 border-cyan-700";
  return "bg-slate-800 text-slate-300 border-slate-600";
}

function stabilityColor(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-yellow-400";
  return "text-red-400";
}

function TrendIcon({ trend }: { trend?: string }) {
  if (trend === "improving") return <TrendingUp className="w-3 h-3 text-emerald-400" />;
  if (trend === "degrading") return <TrendingDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-slate-500" />;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function IntentGroupCard({ group }: { group: IntentGroup }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div
          className="flex items-center justify-between p-3 rounded-lg bg-slate-800/60 border border-slate-700 hover:border-slate-600 cursor-pointer transition-colors"
          data-testid={`intent-group-${group.intentId}`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <GitBranch className="w-4 h-4 text-violet-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">
                {group.intentLabel ?? group.intentId}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatDistanceToNow(new Date(group.lastAt), { addSuffix: true })} ·{" "}
                {group.eventCount} events
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            {group.systems.map((s) => (
              <span
                key={s}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${systemBadgeColor(s)}`}
              >
                {s}
              </span>
            ))}
            {open ? (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500" />
            )}
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-4 mt-1 space-y-1 border-l border-slate-700 pl-3 pb-2">
          {group.events.map((ev, i) => (
            <div key={i} className="flex items-start gap-2 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-600 mt-1.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium ${eventTypeColor(ev.event_type)}`}>
                    {ev.event_type.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-slate-400">{ev.action_type}</span>
                  {ev.entity_name && (
                    <span className="text-xs text-slate-500">→ {ev.entity_name}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] text-slate-600">
                    {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                  </span>
                  {ev.actor_name && (
                    <span className="text-[10px] text-slate-600">by {ev.actor_name}</span>
                  )}
                  {ev.note && (
                    <span className="text-[10px] text-slate-500 italic truncate max-w-[200px]">
                      {ev.note}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function IncidentCorrelationCard({ incident }: { incident: Incident }) {
  const [open, setOpen] = useState(false);
  const correlated = incident.correlatedLedgerEvents ?? [];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div
          className={`flex items-start justify-between p-3 rounded-lg border cursor-pointer transition-colors hover:border-slate-600 ${severityColor(incident.severity)}`}
          data-testid={`incident-card-${incident.id}`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200 leading-tight">
                {incident.title}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[10px] uppercase font-bold tracking-wide">
                  {incident.severity}
                </span>
                <span className="text-[10px] text-slate-500">
                  {formatDistanceToNow(new Date(incident.openedAt), { addSuffix: true })}
                </span>
                {incident.entityName && (
                  <span className="text-[10px] text-slate-500">
                    {incident.entityName}
                  </span>
                )}
                {correlated.length > 0 && (
                  <span className="text-[10px] text-violet-400 flex items-center gap-1">
                    <Link2 className="w-2.5 h-2.5" />
                    {correlated.length} ledger event{correlated.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="shrink-0 ml-2 mt-0.5">
            {open ? (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500" />
            )}
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-1 ml-2 space-y-2 p-3 bg-slate-900/60 rounded-lg border border-slate-800">
          {incident.summary && (
            <p className="text-xs text-slate-400 leading-relaxed">{incident.summary}</p>
          )}
          {correlated.length > 0 ? (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-2">
                Correlated Ledger Events (±15 min)
              </p>
              <div className="space-y-1">
                {correlated.slice(0, 8).map((ev, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className={`text-[10px] font-mono px-1 py-0.5 rounded border ${systemBadgeColor(ev.source_system)}`}
                    >
                      {ev.source_system}
                    </span>
                    <span className={eventTypeColor(ev.event_type)}>
                      {ev.event_type.replace(/_/g, " ")}
                    </span>
                    <span className="text-slate-400">{ev.action_type}</span>
                    {ev.entity_name && (
                      <span className="text-slate-500">→ {ev.entity_name}</span>
                    )}
                    <span className="text-slate-600 text-[10px] ml-auto">
                      {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600 flex items-center gap-1">
              <Info className="w-3 h-3" />
              No ledger events correlated within ±15 min of this incident
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CarrierDriftRow({ score }: { score: CarrierScore }) {
  const stabilityPct = Math.min(100, Math.max(0, score.stabilityScore));

  return (
    <div
      className="flex items-center gap-4 py-2.5 border-b border-slate-800 last:border-0"
      data-testid={`carrier-row-${score.carrierId}`}
    >
      <div className="w-36 truncate">
        <span className="text-sm text-slate-300 font-medium">{score.carrierName}</span>
      </div>

      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-sm font-bold tabular-nums ${stabilityColor(stabilityPct)}`}>
            {stabilityPct}
          </span>
          <span className="text-[10px] text-slate-600">/ 100</span>
          <TrendIcon trend={score.trend} />
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              stabilityPct >= 80
                ? "bg-emerald-500"
                : stabilityPct >= 60
                ? "bg-yellow-500"
                : "bg-red-500"
            }`}
            style={{ width: `${stabilityPct}%` }}
          />
        </div>
      </div>

      <div className="text-right w-20">
        <span className="text-xs text-slate-400 tabular-nums">
          ASR {score.rollingAsr?.toFixed(1) ?? "—"}%
        </span>
      </div>
      <div className="text-right w-20">
        <span className="text-xs text-slate-400 tabular-nums">
          PDD {score.avgPddMs ? (score.avgPddMs / 1000).toFixed(1) + "s" : "—"}
        </span>
      </div>
      <div className="text-right w-16">
        <span className="text-xs text-slate-500 tabular-nums">{score.sampleCount ?? 0} calls</span>
      </div>
    </div>
  );
}

function UnifiedTimeline({ timeline }: { timeline: TimelineItem[] }) {
  return (
    <div className="space-y-1">
      {timeline.length === 0 && (
        <p className="text-sm text-slate-500 py-8 text-center">
          No events in this window
        </p>
      )}
      {timeline.slice(0, 80).map((item, i) => (
        <div
          key={i}
          className="flex items-start gap-3 py-1.5 border-b border-slate-800/60 last:border-0"
        >
          <div className="shrink-0 mt-0.5">
            {item.type === "incident" ? (
              <AlertTriangle
                className={`w-3.5 h-3.5 ${
                  item.severity === "critical"
                    ? "text-red-400"
                    : item.severity === "high"
                    ? "text-orange-400"
                    : "text-yellow-400"
                }`}
              />
            ) : (
              <Zap className="w-3.5 h-3.5 text-violet-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-300 truncate">{item.label}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-slate-600">
                {formatDistanceToNow(new Date(item.ts), { addSuffix: true })}
              </span>
              {item.type === "ledger" && item.system && (
                <span
                  className={`text-[10px] font-mono px-1 py-0.5 rounded border ${systemBadgeColor(item.system)}`}
                >
                  {item.system}
                </span>
              )}
              {item.type === "incident" && item.severity && (
                <span className="text-[10px] uppercase text-orange-400 font-semibold">
                  {item.severity}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const [window, setWindow] = useState(60);

  const { data, isLoading, refetch, isFetching } = useQuery<ChainData>({
    queryKey: ["/api/intelligence/chain", window],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/chain?window=${window}`);
      if (!res.ok) throw new Error("Failed to fetch intelligence data");
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const totals = data?.totals;

  return (
    <div className="flex flex-col gap-6 p-6 min-h-screen bg-slate-950" data-testid="intelligence-page">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-900/30 border border-violet-800">
            <Brain className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">System Intelligence</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Cross-system causal reasoning · ledger + incidents + carrier signal
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Window selector */}
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setWindow(opt.value)}
                data-testid={`window-btn-${opt.value}`}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  window === opt.value
                    ? "bg-violet-700 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="btn-refresh-intelligence"
            className="border-slate-700 text-slate-400 hover:text-slate-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Totals strip */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Ledger Events", value: totals.ledgerEvents, icon: Layers, color: "text-violet-400" },
            { label: "Intent Groups", value: totals.intentGroups, icon: GitBranch, color: "text-cyan-400" },
            { label: "Incidents", value: totals.incidents, icon: AlertTriangle, color: "text-orange-400" },
            { label: "Carriers Scored", value: totals.carriers, icon: Activity, color: "text-emerald-400" },
          ].map((s) => (
            <Card key={s.label} className="bg-slate-900/70 border-slate-800">
              <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
                <s.icon className={`w-4 h-4 ${s.color} shrink-0`} />
                <div>
                  <p className="text-2xl font-bold text-slate-100 tabular-nums">{s.value}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Main tabs */}
      <Tabs defaultValue="chain" className="flex-1">
        <TabsList className="bg-slate-900 border border-slate-800 w-full justify-start">
          <TabsTrigger value="chain" data-testid="tab-event-chain" className="data-[state=active]:bg-slate-700">
            <GitBranch className="w-3.5 h-3.5 mr-1.5" />
            Event Chain
          </TabsTrigger>
          <TabsTrigger value="incidents" data-testid="tab-incidents" className="data-[state=active]:bg-slate-700">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
            Incident Map
            {!!totals?.incidents && totals.incidents > 0 && (
              <span className="ml-1.5 bg-orange-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {totals.incidents}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="drift" data-testid="tab-drift" className="data-[state=active]:bg-slate-700">
            <Activity className="w-3.5 h-3.5 mr-1.5" />
            Performance Drift
          </TabsTrigger>
          <TabsTrigger value="timeline" data-testid="tab-timeline" className="data-[state=active]:bg-slate-700">
            <Clock className="w-3.5 h-3.5 mr-1.5" />
            Unified Timeline
          </TabsTrigger>
        </TabsList>

        {/* ── Panel 1: Event Chain Viewer ──────────────────────────── */}
        <TabsContent value="chain" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3">
              <Card className="bg-slate-900/70 border-slate-800">
                <CardHeader className="py-3 px-4 border-b border-slate-800">
                  <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-violet-400" />
                    Intent Groups
                    <span className="text-xs text-slate-600 font-normal ml-1">
                      Business objectives from the action ledger
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  {isLoading && (
                    <div className="space-y-2">
                      {[1, 2, 3].map((n) => (
                        <div key={n} className="h-12 rounded-lg bg-slate-800 animate-pulse" />
                      ))}
                    </div>
                  )}
                  {!isLoading && (!data?.intentGroups || data.intentGroups.length === 0) && (
                    <div className="py-8 text-center">
                      <GitBranch className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                      <p className="text-sm text-slate-500">No intent groups in this window</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Intent groups appear when ledger events share a common business objective
                      </p>
                    </div>
                  )}
                  {data?.intentGroups.map((g) => (
                    <IntentGroupCard key={g.intentId} group={g} />
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <Card className="bg-slate-900/70 border-slate-800">
                <CardHeader className="py-3 px-4 border-b border-slate-800">
                  <CardTitle className="text-sm font-medium text-slate-300">
                    Unclassified Events
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  {isLoading && (
                    <div className="space-y-1">
                      {[1, 2, 3, 4].map((n) => (
                        <div key={n} className="h-8 rounded bg-slate-800 animate-pulse" />
                      ))}
                    </div>
                  )}
                  {!isLoading && (!data?.noIntentEvents || data.noIntentEvents.length === 0) && (
                    <p className="text-xs text-slate-600 py-4 text-center">
                      All events are classified under intent groups
                    </p>
                  )}
                  {data?.noIntentEvents.map((ev, i) => (
                    <div
                      key={i}
                      className="py-2 border-b border-slate-800 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-mono px-1 rounded border ${systemBadgeColor(ev.source_system)}`}
                        >
                          {ev.source_system}
                        </span>
                        <span className={`text-xs ${eventTypeColor(ev.event_type)}`}>
                          {ev.event_type.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{ev.action_type}</p>
                      <p className="text-[10px] text-slate-600">
                        {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Legend */}
              <Card className="bg-slate-900/70 border-slate-800">
                <CardContent className="p-3 space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-600 font-semibold mb-2">
                    Source Systems
                  </p>
                  {[
                    { sys: "C2", desc: "Account intelligence" },
                    { sys: "ROUTING", desc: "Routing engine" },
                    { sys: "MANUAL", desc: "Manual action" },
                  ].map(({ sys, desc }) => (
                    <div key={sys} className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${systemBadgeColor(sys)}`}>
                        {sys}
                      </span>
                      <span className="text-xs text-slate-500">{desc}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── Panel 2: Incident Correlation Map ───────────────────── */}
        <TabsContent value="incidents" className="mt-4">
          <Card className="bg-slate-900/70 border-slate-800">
            <CardHeader className="py-3 px-4 border-b border-slate-800">
              <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
                Incident Correlation Map
                <span className="text-xs text-slate-600 font-normal ml-1">
                  Each incident shows ledger events that occurred within ±15 min
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 space-y-2">
              {isLoading && (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="h-16 rounded-lg bg-slate-800 animate-pulse" />
                  ))}
                </div>
              )}
              {!isLoading && (!data?.incidents || data.incidents.length === 0) && (
                <div className="py-12 text-center">
                  <AlertTriangle className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No incidents in this window</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Increase the time window or check AI Ops for older incidents
                  </p>
                </div>
              )}
              {data?.incidents.map((inc) => (
                <IncidentCorrelationCard key={inc.id} incident={inc} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Panel 3: Performance Drift ──────────────────────────── */}
        <TabsContent value="drift" className="mt-4">
          <div className="space-y-4">
            <Card className="bg-slate-900/70 border-slate-800">
              <CardHeader className="py-3 px-4 border-b border-slate-800">
                <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  Carrier Signal Drift
                  <span className="text-xs text-slate-600 font-normal ml-1">
                    Stability score, ASR, and PDD per carrier
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {isLoading && (
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <div key={n} className="h-10 rounded bg-slate-800 animate-pulse" />
                    ))}
                  </div>
                )}
                {!isLoading && (!data?.carrierScores || data.carrierScores.length === 0) && (
                  <div className="py-8 text-center">
                    <Activity className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">No carrier data available</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Carrier scores are computed from CDR data. Increase window or wait for CDR cache to fill.
                    </p>
                  </div>
                )}
                {data?.carrierScores.map((score) => (
                  <CarrierDriftRow key={score.carrierId} score={score} />
                ))}
              </CardContent>
            </Card>

            {/* Action events overlay */}
            {data && data.timeline.filter((t) => t.type === "ledger").length > 0 && (
              <Card className="bg-slate-900/70 border-slate-800">
                <CardHeader className="py-3 px-4 border-b border-slate-800">
                  <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-violet-400" />
                    Action Events in Window
                    <span className="text-xs text-slate-600 font-normal ml-1">
                      Ledger mutations that may have affected carrier performance
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 max-h-64 overflow-y-auto">
                  {data.timeline
                    .filter((t) => t.type === "ledger")
                    .slice(0, 40)
                    .map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0 text-xs"
                      >
                        <Zap className="w-3 h-3 text-violet-400 shrink-0" />
                        <span className="text-slate-400 truncate flex-1">{item.label}</span>
                        <span className="text-slate-600 shrink-0">
                          {formatDistanceToNow(new Date(item.ts), { addSuffix: true })}
                        </span>
                      </div>
                    ))}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Panel 4: Unified Timeline ────────────────────────────── */}
        <TabsContent value="timeline" className="mt-4">
          <Card className="bg-slate-900/70 border-slate-800">
            <CardHeader className="py-3 px-4 border-b border-slate-800">
              <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" />
                Unified Causal Timeline
                <span className="text-xs text-slate-600 font-normal ml-1">
                  All ledger actions and incidents merged chronologically
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 max-h-[600px] overflow-y-auto">
              {isLoading && (
                <div className="space-y-2">
                  {Array.from({ length: 10 }).map((_, n) => (
                    <div key={n} className="h-10 rounded bg-slate-800 animate-pulse" />
                  ))}
                </div>
              )}
              {!isLoading && (
                <UnifiedTimeline timeline={data?.timeline ?? []} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
