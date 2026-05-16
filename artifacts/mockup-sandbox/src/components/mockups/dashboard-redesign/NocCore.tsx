import { useState, useEffect } from "react";
import {
  Phone, Activity, Wifi, AlertTriangle, CheckCircle, XCircle,
  TrendingUp, TrendingDown, Minus, Clock, Zap, Shield, Radio,
  ChevronRight, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import {
  RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis
} from "recharts";

const DOMAIN = "dark";

const sampleIncidents = [
  { id: 1, severity: "warning", title: "Carrier ASR degradation — VoicePrime EU", time: "4m ago", delta: "-6.2%" },
  { id: 2, severity: "info",    title: "PDD spike detected — APAC trunk SB-7",   time: "11m ago", delta: "+0.9s" },
  { id: 3, severity: "critical", title: "FAS cluster — 3 events / 90s",           time: "22m ago", delta: "8 events" },
];

const deltaItems = [
  { label: "Active Calls",    prev: 39,     curr: 47,      unit: "",     dir: "up" },
  { label: "ASR",             prev: 71.4,   curr: 74.2,    unit: "%",    dir: "up" },
  { label: "MOS (est.)",      prev: 3.92,   curr: 3.87,    unit: "",     dir: "down" },
  { label: "PDD",             prev: 1.6,    curr: 1.8,     unit: "s",    dir: "down" },
  { label: "CPS",             prev: 2.1,    curr: 2.4,     unit: "",     dir: "up" },
];

const kpis = [
  { label: "ASR",   value: "74.2", unit: "%",   color: "#10b981", ok: true  },
  { label: "MOS",   value: "3.87", unit: " est", color: "#a78bfa", ok: true  },
  { label: "PDD",   value: "1.8",  unit: "s",   color: "#f59e0b", ok: true  },
  { label: "ACD",   value: "142",  unit: "s",   color: "#60a5fa", ok: true  },
  { label: "NER",   value: "81.1", unit: "%",   color: "#34d399", ok: true  },
  { label: "CPS",   value: "2.4",  unit: "",    color: "#fb923c", ok: true  },
];

function NetworkHealthGauge({ score }: { score: number }) {
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  const label = score >= 80 ? "HEALTHY" : score >= 60 ? "DEGRADED" : "CRITICAL";
  const data = [{ value: score, fill: color }];

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-44 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%" cy="50%"
            innerRadius="72%" outerRadius="90%"
            startAngle={225} endAngle={-45}
            data={data}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar
              background={{ fill: "#1e293b" }}
              dataKey="value"
              angleAxisId={0}
              cornerRadius={6}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-black tabular-nums" style={{ color }}>{score}</span>
          <span className="text-[10px] font-bold tracking-widest" style={{ color }}>{label}</span>
        </div>
      </div>
      <span className="text-xs text-slate-400 font-medium">Network Health Score</span>
    </div>
  );
}

function SystemStateBanner({ state }: { state: "operational" | "degraded" | "critical" }) {
  const cfg = {
    operational: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", dot: "bg-emerald-400", label: "ALL SYSTEMS OPERATIONAL" },
    degraded:    { bg: "bg-amber-500/10",   border: "border-amber-500/30",   text: "text-amber-400",   dot: "bg-amber-400",   label: "DEGRADED — MONITORING" },
    critical:    { bg: "bg-rose-500/10",    border: "border-rose-500/30",    text: "text-rose-400",    dot: "bg-rose-400",    label: "CRITICAL — ACTION REQUIRED" },
  }[state];

  return (
    <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border ${cfg.bg} ${cfg.border}`}>
      <span className={`relative flex h-2.5 w-2.5`}>
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-60`} />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.dot}`} />
      </span>
      <span className={`text-xs font-bold tracking-widest ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

function IncidentChip({ inc }: { inc: typeof sampleIncidents[0] }) {
  const sev = {
    critical: { bg: "bg-rose-500/15",   border: "border-rose-500/30",   text: "text-rose-300",   icon: <XCircle className="w-3 h-3 text-rose-400" /> },
    warning:  { bg: "bg-amber-500/15",  border: "border-amber-500/30",  text: "text-amber-300",  icon: <AlertTriangle className="w-3 h-3 text-amber-400" /> },
    info:     { bg: "bg-blue-500/15",   border: "border-blue-500/30",   text: "text-blue-300",   icon: <Radio className="w-3 h-3 text-blue-400" /> },
  }[inc.severity as "critical" | "warning" | "info"];

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${sev.bg} ${sev.border} whitespace-nowrap shrink-0`}>
      {sev.icon}
      <span className={`text-[11px] font-medium ${sev.text}`}>{inc.title}</span>
      <span className="text-[10px] text-slate-500">{inc.time}</span>
      <span className={`text-[10px] font-mono font-bold ${sev.text}`}>{inc.delta}</span>
    </div>
  );
}

function DeltaRow({ item }: { item: typeof deltaItems[0] }) {
  const isUp = item.dir === "up";
  const isGood = (item.label === "Active Calls" || item.label === "ASR" || item.label === "MOS (est.)" || item.label === "CPS") ? isUp : !isUp;
  const color = isGood ? "text-emerald-400" : "text-rose-400";
  const Arrow = isUp ? ArrowUpRight : ArrowDownRight;
  const diff = typeof item.curr === "number" && typeof item.prev === "number"
    ? (item.curr - item.prev)
    : 0;

  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-800/50 last:border-0">
      <span className="text-sm text-slate-300">{item.label}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 tabular-nums">{item.prev}{item.unit}</span>
        <ChevronRight className="w-3 h-3 text-slate-600" />
        <span className="text-sm font-semibold tabular-nums text-slate-100">{item.curr}{item.unit}</span>
        <div className={`flex items-center gap-0.5 text-xs font-bold ${color}`}>
          <Arrow className="w-3.5 h-3.5" />
          <span>{Math.abs(diff).toFixed(1)}{item.unit}</span>
        </div>
      </div>
    </div>
  );
}

export function NocCore() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 4000);
    return () => clearInterval(t);
  }, []);

  const activeCalls = 47 + (tick % 3);
  const healthScore = 83;

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 p-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-5 h-5 text-blue-400" />
            <h1 className="text-lg font-bold text-white tracking-tight">NOC Core</h1>
            <span className="text-xs text-slate-500 font-mono">Layer 1</span>
          </div>
          <p className="text-xs text-slate-400">Real-time operations centre · SB-1 switch · SIP trunk active</p>
        </div>
        <div className="flex items-center gap-3">
          <SystemStateBanner state="operational" />
          <div className="text-right">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Last update</p>
            <p className="text-xs font-mono text-slate-300">19:41:22 UTC</p>
          </div>
        </div>
      </div>

      {/* Hero metrics row */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {/* Active Calls — hero */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Active Calls</span>
            <Phone className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-black tabular-nums text-blue-400">{activeCalls}</span>
              <span className="text-sm text-slate-400">live</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 transition-all duration-700" style={{ width: `${Math.min(activeCalls / 200 * 100, 100)}%` }} />
              </div>
              <span className="text-[10px] text-slate-500 tabular-nums">{activeCalls}/200 cap</span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span className="text-[11px] text-emerald-400 font-medium">NOC WebSocket live</span>
            <span className="text-[10px] text-slate-600">· 60s tick</span>
          </div>
        </div>

        {/* Network Health Gauge */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 flex flex-col items-center justify-center">
          <NetworkHealthGauge score={healthScore} />
          <div className="mt-3 flex gap-4 text-center">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Trend</p>
              <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1"><TrendingUp className="w-3 h-3" /> +2 pts</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Incidents</p>
              <p className="text-xs text-amber-400 font-semibold">{sampleIncidents.length} active</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Uptime</p>
              <p className="text-xs text-slate-300 font-semibold">99.94%</p>
            </div>
          </div>
        </div>

        {/* CPS + Status */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Call Rate</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-4xl font-black tabular-nums text-amber-400">2.4</span>
            <span className="text-sm text-slate-400">CPS</span>
          </div>
          <p className="text-[11px] text-slate-500 mb-4">calls per second · monitoring graph</p>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Connected</span>
              <span className="text-emerald-400 font-bold">38</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Routing</span>
              <span className="text-blue-400 font-bold">9</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">ASR (live est.)</span>
              <span className="text-slate-300 font-bold">81.0%</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-6 gap-3 mb-5">
        {kpis.map(k => (
          <div key={k.label} className="bg-slate-900/50 border border-slate-800/80 rounded-lg px-3 py-3 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{k.label}</p>
            <p className="text-xl font-black tabular-nums" style={{ color: k.color }}>
              {k.value}<span className="text-[10px] font-normal text-slate-400">{k.unit}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Incident Strip */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Incidents</span>
          <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-full px-2">{sampleIncidents.length}</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {sampleIncidents.map(inc => <IncidentChip key={inc.id} inc={inc} />)}
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700/50 text-slate-500 text-[11px] whitespace-nowrap shrink-0 cursor-pointer hover:text-slate-300 transition-colors">
            View all <ChevronRight className="w-3 h-3" />
          </div>
        </div>
      </div>

      {/* Delta Panel */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">What changed · last 15 min</span>
        </div>
        <div>
          {deltaItems.map(item => <DeltaRow key={item.label} item={item} />)}
        </div>
      </div>
    </div>
  );
}
