import {
  DollarSign, TrendingUp, TrendingDown, BarChart2,
  Users, Globe, ArrowUpRight, ArrowDownRight, Wallet
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

const revenueData = [
  { day: "Mon", revenue: 4820, cost: 3210, margin: 1610 },
  { day: "Tue", revenue: 5340, cost: 3480, margin: 1860 },
  { day: "Wed", revenue: 4990, cost: 3390, margin: 1600 },
  { day: "Thu", revenue: 5610, cost: 3720, margin: 1890 },
  { day: "Fri", revenue: 6120, cost: 3980, margin: 2140 },
  { day: "Sat", revenue: 3870, cost: 2560, margin: 1310 },
  { day: "Sun", revenue: 3490, cost: 2310, margin: 1180 },
];

const vendorBalances = [
  { name: "Callntalk",    balance: 270.16, credit: 500,  status: "ok"    },
  { name: "TALK",         balance: 0,      credit: 200,  status: "empty" },
  { name: "YOU",          balance: 0,      credit: 150,  status: "empty" },
  { name: "SkyVoice",     balance: 142.30, credit: 300,  status: "ok"    },
  { name: "BridgeTel",    balance: 387.50, credit: 600,  status: "ok"    },
  { name: "Nexus MENA",   balance: 43.20,  credit: 250,  status: "low"   },
];

const topClients = [
  { name: "TalkGlobal-UK",  revenue: 8240, pct: 28.4, color: "#60a5fa" },
  { name: "EuroVoice",      revenue: 6180, pct: 21.3, color: "#a78bfa" },
  { name: "AsiaBridge",     revenue: 5340, pct: 18.4, color: "#34d399" },
  { name: "USGateway",      revenue: 4210, pct: 14.5, color: "#f59e0b" },
  { name: "Other (12)",     revenue: 5050, pct: 17.4, color: "#475569" },
];

const topDests = [
  { country: "United States", calls: 8410, revenue: 6240 },
  { country: "United Kingdom", calls: 5820, revenue: 4180 },
  { country: "Germany",        calls: 4320, revenue: 3120 },
  { country: "India",          calls: 3980, revenue: 2640 },
  { country: "China",          calls: 3210, revenue: 2100 },
  { country: "Australia",      calls: 2870, revenue: 1980 },
];

const GRID = { stroke: "#1e293b", strokeDasharray: "3 3" };
const AXIS = { fontSize: 11, fill: "#64748b" };

const totalRevenue = revenueData.reduce((a, d) => a + d.revenue, 0);
const totalCost    = revenueData.reduce((a, d) => a + d.cost, 0);
const totalMargin  = revenueData.reduce((a, d) => a + d.margin, 0);
const marginPct    = ((totalMargin / totalRevenue) * 100).toFixed(1);

function MetricCard({ label, value, sub, color, icon: Icon, trend, trendVal }: {
  label: string; value: string; sub: string; color: string; icon: any;
  trend?: "up" | "down"; trendVal?: string;
}) {
  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
          <p className="text-3xl font-black tabular-nums" style={{ color }}>{value}</p>
          <p className="text-[11px] text-slate-400 mt-1">{sub}</p>
        </div>
        <div className="p-2 bg-slate-800/50 rounded-lg">
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      {trend && trendVal && (
        <div className={`flex items-center gap-1 text-xs font-semibold ${trend === "up" ? "text-emerald-400" : "text-rose-400"}`}>
          {trend === "up" ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
          {trendVal} vs. last week
        </div>
      )}
    </div>
  );
}

function VendorRow({ v }: { v: typeof vendorBalances[0] }) {
  const pct = Math.min((v.balance / v.credit) * 100, 100);
  const color = v.status === "ok" ? "#10b981" : v.status === "low" ? "#f59e0b" : "#64748b";
  const textColor = v.status === "ok" ? "text-emerald-400" : v.status === "low" ? "text-amber-400" : "text-slate-500";
  return (
    <div className="flex items-center gap-4 py-3 border-b border-slate-800/40 last:border-0">
      <div className="w-24 shrink-0">
        <p className="text-xs font-medium text-slate-200 truncate">{v.name}</p>
        <p className="text-[10px] text-slate-500">${v.credit} limit</p>
      </div>
      <div className="flex-1">
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>
      <p className={`text-sm font-bold tabular-nums w-16 text-right ${textColor}`}>
        ${v.balance.toFixed(2)}
      </p>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="font-bold">
          {p.name.charAt(0).toUpperCase() + p.name.slice(1)}: ${p.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
};

export function BusinessIntel() {
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 p-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart2 className="w-5 h-5 text-emerald-400" />
            <h1 className="text-lg font-bold text-white tracking-tight">Business Intelligence</h1>
            <span className="text-xs text-slate-500 font-mono">Layer 3</span>
          </div>
          <p className="text-xs text-slate-400">Revenue & margin analysis · Vendor balances · Client distribution · Top destinations</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Period:</span>
          <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300">Last 7 days</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <MetricCard
          label="Total Revenue" value={`$${(totalRevenue / 1000).toFixed(1)}k`}
          sub="last 7 days · origination" color="#34d399" icon={DollarSign}
          trend="up" trendVal="+8.4%"
        />
        <MetricCard
          label="Total Cost" value={`$${(totalCost / 1000).toFixed(1)}k`}
          sub="termination spend" color="#60a5fa" icon={Wallet}
          trend="up" trendVal="+5.1%"
        />
        <MetricCard
          label="Gross Margin" value={`${marginPct}%`}
          sub={`$${(totalMargin / 1000).toFixed(1)}k absolute margin`} color="#f59e0b" icon={TrendingUp}
          trend="up" trendVal="+1.2 pts"
        />
      </div>

      {/* Revenue / Cost / Margin Chart */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-100">Revenue vs Cost vs Margin</h3>
          <div className="flex items-center gap-4 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-400 inline-block" /> Revenue</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-400 inline-block" /> Cost</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400 inline-block border-dashed border-t" /> Margin</span>
          </div>
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#34d399" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="marGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="day" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={v => `$${(v/1000).toFixed(1)}k`} width={44} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#334155", strokeWidth: 1 }} />
              <Area type="monotone" dataKey="revenue" stroke="#34d399" strokeWidth={2} fill="url(#revGrad)" dot={false} />
              <Area type="monotone" dataKey="cost"    stroke="#60a5fa" strokeWidth={1.5} fill="url(#costGrad)" dot={false} />
              <Area type="monotone" dataKey="margin"  stroke="#f59e0b" strokeWidth={1.5} fill="url(#marGrad)" dot={false} strokeDasharray="4 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom 3-column grid */}
      <div className="grid grid-cols-3 gap-4">
        {/* Vendor Balances */}
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-3.5 h-3.5 text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-100">Vendor Balances</h3>
          </div>
          {vendorBalances.map(v => <VendorRow key={v.name} v={v} />)}
        </div>

        {/* Top Clients */}
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-3.5 h-3.5 text-violet-400" />
            <h3 className="text-sm font-semibold text-slate-100">Top Clients · 30d</h3>
          </div>
          <div className="h-36 mb-3">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={topClients} dataKey="revenue" cx="50%" cy="50%" outerRadius={60} innerRadius={35} strokeWidth={0}>
                  {topClients.map((c, i) => <Cell key={i} fill={c.color} fillOpacity={0.85} />)}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => active && payload?.length ? (
                    <div className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs">
                      <p style={{ color: payload[0].payload.color }}>{payload[0].payload.name}</p>
                      <p className="text-slate-300">${payload[0].value?.toLocaleString()} · {payload[0].payload.pct}%</p>
                    </div>
                  ) : null}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {topClients.map(c => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="text-slate-300 truncate max-w-[100px]">{c.name}</span>
                </div>
                <span className="tabular-nums text-slate-400 font-medium">{c.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Destinations */}
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-3.5 h-3.5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-100">Top Destinations · 7d</h3>
          </div>
          <div className="space-y-2">
            {topDests.map((d, i) => (
              <div key={d.country} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-600 w-4 tabular-nums">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-slate-200 truncate max-w-[110px]">{d.country}</span>
                    <span className="text-[11px] text-emerald-400 font-bold tabular-nums">${(d.revenue / 1000).toFixed(1)}k</span>
                  </div>
                  <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 opacity-70"
                      style={{ width: `${(d.calls / topDests[0].calls) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-[10px] text-slate-500 tabular-nums w-12 text-right">{(d.calls / 1000).toFixed(1)}k calls</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
