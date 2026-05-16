import { useState } from "react";
import {
  Activity, ChevronDown, ChevronRight, AlertTriangle,
  CheckCircle, TrendingDown, Server, Eye, Filter
} from "lucide-react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell
} from "recharts";

const asrTrend = [
  { time: "18:00", asr: 71.2, acd: 138 },
  { time: "18:15", asr: 73.4, acd: 141 },
  { time: "18:30", asr: 69.8, acd: 136 },
  { time: "18:45", asr: 72.1, acd: 143 },
  { time: "19:00", asr: 74.5, acd: 145 },
  { time: "19:15", asr: 75.2, acd: 148 },
  { time: "19:30", asr: 73.8, acd: 142 },
  { time: "19:41", asr: 74.2, acd: 142 },
];

const carriers = [
  { name: "VoicePrime EU",   score: 76, asr: 71.2, calls: 312, status: "degraded",     change: -6.2 },
  { name: "GlobalLink APAC", score: 88, asr: 81.4, calls: 218, status: "healthy",      change: +1.1 },
  { name: "Callntalk INT",   score: 91, asr: 84.7, calls: 189, status: "healthy",      change: +0.8 },
  { name: "SkyVoice US",     score: 82, asr: 76.3, calls: 144, status: "healthy",      change: -0.3 },
  { name: "Nexus MENA",      score: 67, asr: 63.1, calls: 97,  status: "at-risk",      change: -4.8 },
  { name: "BridgeTel UK",    score: 93, asr: 86.2, calls: 74,  status: "healthy",      change: +2.1 },
];

const fasBreakdown = [
  { name: "Zero Billed",   count: 14, color: "#ef4444" },
  { name: "High PDD",      count: 8,  color: "#f97316" },
  { name: "Short Billed",  count: 6,  color: "#a855f7" },
  { name: "Early Answer",  count: 3,  color: "#eab308" },
];

const sampleCalls = [
  { id: "c-8821", caller: "+447911123456", callee: "+12125551234", account: "TalkGlobal-UK", state: "connected", dur: "3:12", pdd: "1.2s" },
  { id: "c-8819", caller: "+33612345678",  callee: "+8613800138000", account: "EuroVoice",   state: "connected", dur: "1:44", pdd: "2.1s" },
  { id: "c-8817", caller: "+19175550101",  callee: "+971501234567",  account: "USGateway",   state: "routing",   dur: "0:07", pdd: "—" },
  { id: "c-8814", caller: "+61291234567",  callee: "+919876543210",  account: "AsiaBridge",  state: "connected", dur: "5:51", pdd: "0.9s" },
  { id: "c-8810", caller: "+4917612345678",callee: "+34912345678",   account: "EuroVoice",   state: "connected", dur: "2:23", pdd: "1.5s" },
];

const GRID_STYLE = { stroke: "#1e293b", strokeDasharray: "3 3" };
const AXIS_STYLE = { fontSize: 11, fill: "#64748b", fontFamily: "monospace" };

function StatusDot({ status }: { status: string }) {
  const cls = status === "healthy" ? "bg-emerald-400" : status === "degraded" ? "bg-amber-400" : "bg-rose-400";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 85 ? "#10b981" : score >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color }}>{score}</span>
    </div>
  );
}

function Section({ title, icon: Icon, badge, defaultOpen = true, children }: {
  title: string; icon: any; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl overflow-hidden mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-100">{title}</span>
          {badge}
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
      </button>
      {open && <div className="border-t border-slate-800/40">{children}</div>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1 font-mono">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="font-bold">
          {p.name === "asr" ? `ASR: ${p.value}%` : `ACD: ${p.value}s`}
        </p>
      ))}
    </div>
  );
};

export function Diagnostics() {
  const [trendWindow, setTrendWindow] = useState("1h");

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 p-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-5 h-5 text-violet-400" />
            <h1 className="text-lg font-bold text-white tracking-tight">Diagnostics</h1>
            <span className="text-xs text-slate-500 font-mono">Layer 2</span>
          </div>
          <p className="text-xs text-slate-400">Deep-dive quality analysis · ASR trends · Carrier breakdown · FAS events</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:border-slate-600 transition-colors">
            <Filter className="w-3 h-3" /> Filter
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:border-slate-600 transition-colors">
            <Eye className="w-3 h-3" /> Export
          </button>
        </div>
      </div>

      {/* ASR / ACD Trend */}
      <Section
        title="ASR & ACD Trend"
        icon={Activity}
        badge={
          <div className="flex gap-1 ml-3">
            {["1h","6h","24h"].map(w => (
              <button
                key={w}
                onClick={e => { e.stopPropagation(); setTrendWindow(w); }}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${trendWindow === w ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" : "text-slate-500 hover:text-slate-300"}`}
              >
                {w}
              </button>
            ))}
          </div>
        }
      >
        <div className="px-5 py-4">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={asrTrend} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="asrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="time" {...AXIS_STYLE} />
                <YAxis yAxisId="asr" orientation="left"  {...AXIS_STYLE} domain={[60, 90]} tickFormatter={v => `${v}%`} width={34} />
                <YAxis yAxisId="acd" orientation="right" {...AXIS_STYLE} tickFormatter={v => `${v}s`} width={34} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#334155", strokeWidth: 1 }} />
                <Area yAxisId="asr" type="monotone" dataKey="asr" stroke="#10b981" strokeWidth={2.5} fill="url(#asrGrad)" dot={false} />
                <Line yAxisId="acd" type="monotone" dataKey="acd" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-5 mt-2 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-emerald-500 inline-block rounded" /> ASR %</span>
            <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-violet-400 inline-block" /> ACD (s)</span>
          </div>
        </div>
      </Section>

      {/* Carrier Health */}
      <Section
        title="Carrier Health Breakdown"
        icon={Server}
        badge={
          <span className="ml-2 text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5">
            1 degraded · 1 at-risk
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/30 text-slate-500 text-[10px] uppercase tracking-wider">
                <th className="px-5 py-2.5 text-left">Carrier</th>
                <th className="px-4 py-2.5 text-left">Score</th>
                <th className="px-4 py-2.5 text-left">ASR 24h</th>
                <th className="px-4 py-2.5 text-left">Calls</th>
                <th className="px-4 py-2.5 text-left">Δ vs. prev</th>
                <th className="px-4 py-2.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {carriers.map(c => (
                <tr key={c.name} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-200">{c.name}</td>
                  <td className="px-4 py-3"><ScoreBar score={c.score} /></td>
                  <td className="px-4 py-3 tabular-nums text-slate-300">{c.asr.toFixed(1)}%</td>
                  <td className="px-4 py-3 tabular-nums text-slate-400">{c.calls}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold tabular-nums flex items-center gap-0.5 ${c.change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {c.change >= 0 ? "+" : ""}{c.change.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={c.status} />
                      <span className="text-[11px] text-slate-400 capitalize">{c.status.replace("-", " ")}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* FAS Events */}
      <Section
        title="FAS Events & Classification"
        icon={AlertTriangle}
        badge={
          <span className="ml-2 text-[10px] bg-rose-500/15 text-rose-400 border border-rose-500/20 rounded-full px-2 py-0.5">
            31 events
          </span>
        }
        defaultOpen={false}
      >
        <div className="px-5 py-4 grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">By Category (last 90 min)</p>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fasBreakdown} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid {...GRID_STYLE} horizontal={false} />
                  <XAxis dataKey="name" {...AXIS_STYLE} tick={{ fontSize: 10 }} />
                  <YAxis {...AXIS_STYLE} />
                  <Tooltip
                    cursor={{ fill: "#1e293b" }}
                    content={({ active, payload }) => active && payload?.length ? (
                      <div className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs">
                        <span style={{ color: payload[0].payload.color }}>{payload[0].payload.name}: {payload[0].value}</span>
                      </div>
                    ) : null}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {fasBreakdown.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.8} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Event Summary</p>
            <div className="space-y-2">
              {fasBreakdown.map(e => (
                <div key={e.name} className="flex items-center justify-between py-1.5 border-b border-slate-800/40 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: e.color }} />
                    <span className="text-xs text-slate-300">{e.name}</span>
                  </div>
                  <span className="text-xs font-bold tabular-nums" style={{ color: e.color }}>{e.count}</span>
                </div>
              ))}
              <div className="pt-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">Total</span>
                <span className="text-slate-200 font-bold">31</span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Live Call Sample */}
      <Section title="Live Call Sample" icon={CheckCircle} defaultOpen={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800/30 text-slate-500 text-[10px] uppercase tracking-wider">
                <th className="px-5 py-2.5 text-left">Caller</th>
                <th className="px-4 py-2.5 text-left">Callee</th>
                <th className="px-4 py-2.5 text-left">Account</th>
                <th className="px-4 py-2.5 text-left">State</th>
                <th className="px-4 py-2.5 text-left">Duration</th>
                <th className="px-4 py-2.5 text-left">PDD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {sampleCalls.map(c => (
                <tr key={c.id} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-5 py-2.5 font-mono text-slate-300">{c.caller}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-300">{c.callee}</td>
                  <td className="px-4 py-2.5 text-slate-400">{c.account}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.state === "connected" ? "bg-emerald-500/15 text-emerald-400" : "bg-blue-500/15 text-blue-400"}`}>
                      {c.state}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-slate-300">{c.dur}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-400">{c.pdd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
