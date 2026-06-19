
import { useState } from "react";

const BLUE = "#3B82F6";
const VIOLET = "#8B5CF6";
const EMERALD = "#10B981";
const AMBER = "#F59E0B";
const ROSE = "#F43F5E";
const INDIGO = "#6366F1";

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">{children}</span>
      <div className="flex-1 h-px bg-blue-500/15" />
    </div>
  );
}

function KpiCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: string }) {
  return (
    <div style={{ borderColor: color + "33", background: color + "08" }}
      className="border rounded-xl p-4 flex flex-col gap-2 relative overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <span className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</span>
      <span className="text-xs text-gray-500">{sub}</span>
    </div>
  );
}

function WorkflowCard({ label, desc, stat1, stat2, urgent }: any) {
  return (
    <div className={`border rounded-xl p-4 flex flex-col gap-2 ${urgent ? "border-amber-500/25 bg-amber-500/5" : "border-gray-700/50 bg-gray-800/40"}`}>
      <div className="flex items-start justify-between">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${urgent ? "bg-amber-500/15" : "bg-gray-700/50"}`}>
          <div className="w-3 h-3 rounded-sm" style={{ background: urgent ? AMBER : "#6B7280" }} />
        </div>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${urgent ? "border-amber-500/30 text-amber-400 bg-amber-500/10" : "border-gray-600/50 text-gray-500"}`}>
          {urgent ? "HIGH" : "NORMAL"}
        </span>
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-100">{label}</p>
        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{desc}</p>
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-gray-700/40 text-xs">
        <span className="font-bold text-gray-200">{stat1.v} <span className="font-normal text-gray-500">{stat1.l}</span></span>
        <div className="w-px h-3 bg-gray-700" />
        <span className="font-bold text-gray-200">{stat2.v} <span className="font-normal text-gray-500">{stat2.l}</span></span>
      </div>
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex-1 h-1.5 bg-gray-700/60 rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} />
    </div>
  );
}

const TRAFFIC_POINTS = [12, 18, 14, 22, 30, 26, 34, 38, 32, 42, 36, 44, 40, 48, 45, 52, 50, 58, 56, 62, 58, 66, 72, 68, 74, 70, 78, 82, 76, 84, 80, 88, 86, 92, 90];

function TrafficSvg() {
  const W = 520, H = 90;
  const max = Math.max(...TRAFFIC_POINTS), min = Math.min(...TRAFFIC_POINTS);
  const range = max - min || 1;
  const pts = TRAFFIC_POINTS.map((v, i) => {
    const x = (i / (TRAFFIC_POINTS.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const fill = TRAFFIC_POINTS.map((v, i) => {
    const x = (i / (TRAFFIC_POINTS.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `M${fill[0]} ${fill.slice(1).map(p => `L${p}`).join(" ")} L${W},${H} L0,${H} Z`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BLUE} stopOpacity="0.25" />
          <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#tg)" />
      <polyline points={pts} fill="none" stroke={BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      {(() => {
        const lastX = parseFloat(fill[fill.length - 1].split(",")[0]);
        const lastY = parseFloat(fill[fill.length - 1].split(",")[1]);
        return <circle cx={lastX} cy={lastY} r="3" fill={BLUE} />;
      })()}
    </svg>
  );
}

function SmallSparkline({ color }: { color: string }) {
  const pts = [4, 6, 3, 8, 5, 9, 7, 11, 8, 12, 10, 14];
  const W = 52, H = 18;
  const max = Math.max(...pts), min = Math.min(...pts), range = max - min || 1;
  const p = pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - min) / range) * (H - 3) - 1.5).toFixed(1)}`).join(" ");
  return <svg width={W} height={H}><polyline points={p} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function CockpitDashboard() {
  const [activeTab, setActiveTab] = useState<"LIVE" | "24H" | "7D">("LIVE");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-5 space-y-5 font-sans text-sm">

      {/* ── Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight">Live Operations</h1>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">NOMINAL</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">Sippy Softswitch · ssp-root · refreshed 12s ago</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded-lg border border-gray-700/60 bg-gray-800/40 text-xs text-gray-400 hover:text-gray-200 transition-colors">⚙ Customize</button>
          <div className="rounded-xl border border-gray-700/60 bg-gray-800/60 px-4 py-2 text-right">
            <div className="font-mono text-2xl font-bold">10:31:22</div>
            <div className="text-[11px] text-gray-500 font-mono">23 May 2026 <span className="text-indigo-400 font-semibold">UTC</span></div>
          </div>
        </div>
      </div>

      {/* ── S1: KPI Strip */}
      <div>
        <SectionLabel>§1 — KPI Strip</SectionLabel>
        <div className="grid grid-cols-4 gap-3">
          <KpiCard label="Active Calls" value="84" sub="live · connected" color={BLUE} icon="📞" />
          <KpiCard label="Active Alerts" value="3" sub="1 critical · 2 open" color={AMBER} icon="⚠️" />
          <KpiCard label="Degraded Carriers" value="2" sub="score below 60" color={ROSE} icon="📉" />
          <KpiCard label="Pending Approvals" value="0" sub="queue empty" color={VIOLET} icon="✅" />
        </div>
      </div>

      {/* ── S2: Smart Priorities */}
      <div>
        <SectionLabel>§2 — Smart Priorities</SectionLabel>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-amber-500/15">
            <div className="flex items-center gap-2">
              <span className="text-amber-400">⚠</span>
              <span className="font-semibold text-sm">Smart Priorities</span>
              <span className="text-xs text-gray-500">2 items require immediate attention</span>
            </div>
            <span className="text-xs text-amber-400 cursor-pointer">View All (3) →</span>
          </div>
          <div className="p-3 grid grid-cols-3 gap-3">
            {[
              { sev: "CRITICAL", title: "Pakistan Mobile ASR Drop", desc: "vendor · UConnect PK" },
              { sev: "HIGH", title: "Bangladesh Latency Spike", desc: "route · BD-Gateway · 420ms PDD" },
              { sev: "MEDIUM", title: "UAE Mobile FAS Rate", desc: "carrier · Etisalat UAE · 18% FAS" },
            ].map((inc, i) => (
              <div key={i} className="bg-gray-800/60 border border-gray-700/50 hover:border-amber-500/25 rounded-lg p-3 cursor-pointer transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${inc.sev === "CRITICAL" ? "border-red-500/40 text-red-400 bg-red-500/10" : inc.sev === "HIGH" ? "border-amber-500/40 text-amber-400 bg-amber-500/10" : "border-yellow-500/40 text-yellow-400 bg-yellow-500/10"}`}>
                    {inc.sev}
                  </span>
                  <span className="text-gray-600">›</span>
                </div>
                <p className="text-sm font-semibold leading-snug">{inc.title}</p>
                <p className="text-[11px] text-gray-500 mt-1">{inc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── S3: Primary Workflows */}
      <div>
        <SectionLabel>§3 — Primary Workflows</SectionLabel>
        <div className="grid grid-cols-3 gap-3">
          <WorkflowCard label="Live Call Monitor" desc="Real-time active call supervision and FAS detection" stat1={{ v: "84", l: "active" }} stat2={{ v: "3", l: "FAS risk" }} urgent />
          <WorkflowCard label="Vendor Intelligence" desc="Carrier performance scoring and degradation analysis" stat1={{ v: "12", l: "carriers" }} stat2={{ v: "2", l: "degraded" }} urgent />
          <WorkflowCard label="Routing Manager" desc="Manage routing groups, LCR and destination sets" stat1={{ v: "28", l: "groups" }} stat2={{ v: "156", l: "routes" }} urgent={false} />
          <WorkflowCard label="Analytics — BitsEye" desc="Deep drill-down traffic and revenue analytics" stat1={{ v: "2.4M", l: "CDRs" }} stat2={{ v: "99.1%", l: "ASR" }} urgent={false} />
          <WorkflowCard label="Fraud & Security" desc="FAS/IRSF detection and auto-blacklist engine" stat1={{ v: "0", l: "blacklisted" }} stat2={{ v: "2", l: "FAS events" }} urgent={false} />
          <WorkflowCard label="Client Management" desc="Account provisioning, rate cards and billing" stat1={{ v: "47", l: "clients" }} stat2={{ v: "6", l: "pending" }} urgent={false} />
        </div>
      </div>

      {/* ── S4: LIVE TELEMETRY GRID ← RESTORED */}
      <div>
        <SectionLabel>§4 — Live Telemetry Grid ← RESTORED</SectionLabel>
        <div className="grid grid-cols-10 gap-3">

          {/* LEFT 70% — Traffic Graph + Live Calls Table */}
          <div className="col-span-7 space-y-3">

            {/* Traffic Graph */}
            <div className="rounded-xl border border-blue-500/20 bg-gray-900/60 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-sm font-semibold">Total Traffic</span>
                  <span className="text-[10px] text-gray-500">· 84 calls · 9.2 CPS · ASR 99.1% · ACD 3m 22s</span>
                </div>
                <div className="flex items-center gap-1">
                  {(["LIVE", "24H", "7D"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setActiveTab(t)}
                      className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${activeTab === t ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-gray-500 hover:text-gray-300"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-4 py-3">
                <TrafficSvg />
                <div className="flex items-center justify-between mt-2 text-[10px] text-gray-600">
                  <span>-30min</span><span>-25</span><span>-20</span><span>-15</span><span>-10</span><span>-5</span><span>now</span>
                </div>
              </div>
            </div>

            {/* Live Calls Table */}
            <div className="rounded-xl border border-gray-700/50 bg-gray-900/60 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm font-semibold">Live Calls</span>
                  <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded">84 active</span>
                </div>
                <span className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">View all →</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/40">
                    {["Caller", "Callee", "Client", "State", "Duration", "Vendor", "Codec", "Answer"].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { caller: "+4478901234", callee: "+923001234567", client: "Callntalk", state: "connected", dur: "2m 14s", vendor: "UConnect", codec: "G711", ans: "Real Answer" },
                    { caller: "+12025550191", callee: "+8801711234567", client: "TALK Ltd", state: "connected", dur: "0m 02s", vendor: "BD-GW", codec: "G729", ans: "FAS Risk" },
                    { caller: "+33123456789", callee: "+971501234567", client: "YOU Telecom", state: "routing", dur: "0s", vendor: "Etisalat", codec: "—", ans: "Routing" },
                    { caller: "+447700900000", callee: "+919876543210", client: "Callntalk", state: "connected", dur: "5m 31s", vendor: "Airtel-IN", codec: "G711", ans: "Real Answer" },
                    { caller: "+12125551234", callee: "+601112345678", client: "internal-sky", state: "connected", dur: "1m 09s", vendor: "MY-Gateway", codec: "Opus", ans: "Real Answer" },
                  ].map((row, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono">{row.caller}</td>
                      <td className="px-4 py-2.5 font-mono">{row.callee}</td>
                      <td className="px-4 py-2.5 text-violet-400">{row.client}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${row.state === "connected" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                          {row.state}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-gray-400">{row.dur}</td>
                      <td className="px-4 py-2.5 text-blue-400">{row.vendor}</td>
                      <td className="px-4 py-2.5 text-gray-500">{row.codec}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${row.ans === "Real Answer" ? "bg-emerald-500/10 text-emerald-400" : row.ans === "FAS Risk" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>
                          {row.ans}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT 30% — Top Clients / Vendors / Routes */}
          <div className="col-span-3 space-y-3">
            {[
              { title: "Top Clients", color: VIOLET, spark: "#8B5CF6", rows: [{ name: "Callntalk", calls: 34, cr: 98 }, { name: "TALK Ltd", calls: 22, cr: 96 }, { name: "YOU Telecom", calls: 18, cr: 91 }] },
              { title: "Top Vendors", color: BLUE, spark: "#3B82F6", rows: [{ name: "UConnect PK", calls: 28, cr: 88 }, { name: "BD-Gateway", calls: 19, cr: 72 }, { name: "Airtel-IN", calls: 15, cr: 97 }] },
              { title: "Top Routes", color: EMERALD, spark: "#10B981", rows: [{ name: "PK-Mobile-1", calls: 24, cr: 89 }, { name: "BD-National", calls: 17, cr: 74 }, { name: "UAE-Etisalat", calls: 14, cr: 95 }] },
            ].map(card => (
              <div key={card.title} className="rounded-xl border bg-gray-900/60 overflow-hidden"
                style={{ borderColor: card.color + "33" }}>
                <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-700/40">
                  <span className="text-xs font-semibold" style={{ color: card.color }}>{card.title}</span>
                  <span className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-300">More →</span>
                </div>
                <div className="divide-y divide-gray-800/50 px-3.5 py-1">
                  {card.rows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2 py-2">
                      <span className="text-[10px] font-bold text-gray-600 w-3.5 text-right">{i + 1}</span>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: card.color }} />
                      <span className="text-[11px] font-medium truncate flex-1">{row.name}</span>
                      <SmallSparkline color={card.spark} />
                      <span className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: card.color + "20", color: card.color }}>{row.calls}</span>
                      <span className={`text-[10px] tabular-nums font-semibold w-8 text-right ${row.cr >= 90 ? "text-emerald-400" : row.cr >= 70 ? "text-amber-400" : "text-rose-400"}`}>{row.cr}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── S5: System Health ← RESTORED */}
      <div>
        <SectionLabel>§5 — System Health ← RESTORED</SectionLabel>
        <div className="rounded-xl border border-gray-700/50 bg-gray-900/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400">⬤</span>
              <span className="text-sm font-semibold">System Health</span>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">All Systems Operational</span>
            </div>
            <span className="text-[10px] text-gray-500">updated 8s ago</span>
          </div>
          <div className="grid grid-cols-6 gap-0 divide-x divide-gray-800">
            {[
              { label: "CPU", value: 23, unit: "%", color: EMERALD, status: "Normal" },
              { label: "Memory", value: 61, unit: "%", color: BLUE, status: "Normal" },
              { label: "Database", value: 100, unit: "%", color: EMERALD, status: "Connected" },
              { label: "WebSocket", value: 100, unit: "%", color: EMERALD, status: "3 clients" },
              { label: "Cache", value: 100, unit: "%", color: EMERALD, status: "Fresh · 12s" },
              { label: "Poll Engine", value: 100, unit: "%", color: EMERALD, status: "Running" },
            ].map((item, i) => (
              <div key={i} className="px-4 py-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{item.label}</span>
                  <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-2xl font-bold tabular-nums" style={{ color: item.color }}>{item.value}</span>
                  <span className="text-xs text-gray-500 mb-0.5">{item.unit}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MiniBar value={item.value} max={100} color={item.color} />
                </div>
                <span className="text-[10px] text-gray-500">{item.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── S6: Quick Actions */}
      <div>
        <SectionLabel>§6 — Quick Actions (already present)</SectionLabel>
        <div className="grid grid-cols-5 gap-3">
          {[
            { icon: "🔔", label: "Create Alert", href: "/alerts" },
            { icon: "💰", label: "Check Balance", href: "/vendors" },
            { icon: "🔀", label: "Add Route", href: "/routing" },
            { icon: "📊", label: "Generate Report", href: "/analytics" },
            { icon: "📞", label: "Test Route", href: "/tools" },
          ].map(qa => (
            <div key={qa.label}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-700/50 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/60 transition-all duration-200 cursor-pointer text-center">
              <div className="text-2xl">{qa.icon}</div>
              <span className="text-xs font-medium text-gray-400">{qa.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── S7: Risk Destinations ← RESTORED */}
      <div>
        <SectionLabel>§7 — Risk Destinations ← RESTORED</SectionLabel>
        <div className="rounded-xl border border-rose-500/20 bg-gray-900/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
            <div className="flex items-center gap-2">
              <span className="text-rose-400">⚠</span>
              <span className="text-sm font-semibold">Risk Destinations</span>
              <span className="text-[10px] text-gray-500">· routing intelligence · degradation & fraud risk scoring</span>
            </div>
            <span className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">View all →</span>
          </div>
          <div className="divide-y divide-gray-800/60">
            {[
              { dest: "Pakistan Mobile", prefix: "92300–92399", degScore: 34, fasRisk: "High", instability: "Rising", asr: 41, trend: "↓" },
              { dest: "Bangladesh National", prefix: "8801–8803", degScore: 58, fasRisk: "Medium", instability: "Stable", asr: 67, trend: "→" },
              { dest: "UAE Mobile — Etisalat", prefix: "97150–97155", degScore: 62, fasRisk: "High", instability: "Fluctuating", asr: 72, trend: "↑" },
              { dest: "Nigeria Mobile", prefix: "2348", degScore: 29, fasRisk: "Critical", instability: "Degrading", asr: 28, trend: "↓↓" },
            ].map((row, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-800/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-100">{row.dest}</p>
                  <p className="text-[11px] text-gray-500 font-mono mt-0.5">{row.prefix}</p>
                </div>
                {/* Degradation Score */}
                <div className="text-center w-20">
                  <p className="text-[10px] text-gray-500 mb-1">Degrad. Score</p>
                  <div className="flex items-center gap-1.5">
                    <MiniBar value={row.degScore} max={100} color={row.degScore < 40 ? ROSE : row.degScore < 60 ? AMBER : EMERALD} />
                    <span className={`text-xs font-bold tabular-nums ${row.degScore < 40 ? "text-rose-400" : row.degScore < 60 ? "text-amber-400" : "text-emerald-400"}`}>{row.degScore}</span>
                  </div>
                </div>
                {/* ASR */}
                <div className="text-center w-16">
                  <p className="text-[10px] text-gray-500 mb-1">ASR</p>
                  <span className={`text-sm font-bold ${row.asr < 40 ? "text-rose-400" : row.asr < 70 ? "text-amber-400" : "text-emerald-400"}`}>{row.asr}%</span>
                  <span className="ml-1 text-xs">{row.trend}</span>
                </div>
                {/* FAS Risk */}
                <div className="text-center w-20">
                  <p className="text-[10px] text-gray-500 mb-1">FAS Risk</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${row.fasRisk === "Critical" ? "border-red-500/40 text-red-400 bg-red-500/10" : row.fasRisk === "High" ? "border-amber-500/40 text-amber-400 bg-amber-500/10" : "border-yellow-500/30 text-yellow-400 bg-yellow-500/10"}`}>
                    {row.fasRisk}
                  </span>
                </div>
                {/* Instability */}
                <div className="text-center w-24">
                  <p className="text-[10px] text-gray-500 mb-1">Instability</p>
                  <span className={`text-xs font-semibold ${row.instability === "Degrading" || row.instability === "Rising" ? "text-rose-400" : row.instability === "Fluctuating" ? "text-amber-400" : "text-gray-400"}`}>
                    {row.instability}
                  </span>
                </div>
                {/* Navigate */}
                <span className="text-gray-600 text-sm cursor-pointer hover:text-gray-300">›</span>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
